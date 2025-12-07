// @ts-nocheck
"use client";

import React, { useEffect, useRef, useState } from "react";

const ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";
const SAMPLE_RATE = 16000;

const VoiceToTextProPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Idle");
  const [isRecordRTCLoaded, setIsRecordRTCLoaded] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<any>(null);
  const committedTextRef = useRef<string>("");
  const RecordRTCRef = useRef<any>(null); // will hold the RecordRTC module

  // 🔹 Dynamically load RecordRTC only in the browser
  useEffect(() => {
    let cancelled = false;

    const loadRecordRTC = async () => {
      try {
        const mod = await import("recordrtc");
        if (!cancelled) {
          RecordRTCRef.current = mod.default || mod;
          setIsRecordRTCLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load RecordRTC:", err);
        setStatus("Error loading audio recorder");
      }
    };

    loadRecordRTC();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleRecording = async () => {
    const currentlyRecording = isRecording;
    setIsRecording(!currentlyRecording);

    // 🔴 STOP RECORDING
    if (currentlyRecording) {
      setStatus("Stopping...");
      if (recorderRef.current) {
        recorderRef.current.pauseRecording();
        recorderRef.current = null;
      }
      // 👇 Force server to finalize the last partial turn
      if (
        socketRef.current &&
        socketRef.current.readyState === WebSocket.OPEN
      ) {
        try {
          socketRef.current.send(JSON.stringify({ type: "Terminate" }));
        } catch {}
        socketRef.current.close();
      }
      socketRef.current = null;

      // 👇 Make sure UI keeps the last known text
      setText(committedTextRef.current || text);
      setStatus("Idle");
      return;
    }

    // If RecordRTC is not ready yet
    if (!RecordRTCRef.current) {
      alert("Audio recorder is still loading. Try again in a moment.");
      setIsRecording(false);
      return;
    }

    const RecordRTC = RecordRTCRef.current;

    // 🟢 START RECORDING
    try {
      setStatus("Getting session token...");
      const res = await fetch("http://localhost:8000/token");
      const { token, error } = await res.json();

      if (error || !token) {
        console.error("Token error:", error);
        alert("Error getting token from server");
        setIsRecording(false);
        setStatus("Idle");
        return;
      }

      setStatus("Connecting to AssemblyAI...");
      const ws = new WebSocket(
        `${ENDPOINT}?sample_rate=${SAMPLE_RATE}&encoding=pcm_s16le&token=${token}`
      );
      socketRef.current = ws;

      let committedText = "";
      committedTextRef.current = "";

      ws.onmessage = ({ data }) => {
        const msg = JSON.parse(data);

        if (msg.type === "Begin") {
          setStatus("Listening...");
          return;
        }

        let committedText = committedTextRef.current || "";

        if (msg.type === "Turn") {
          const live = committedText + msg.transcript;
          setText(live);

          if (msg.end_of_turn) {
            committedText +=
              (msg.turn_is_formatted ? msg.transcript : msg.transcript + ".") +
              " ";
            committedTextRef.current = committedText;
          }
        }

        if (msg.type === "Termination") {
          setStatus("Session ended");
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket error:", e);
        setStatus("Error");
        setIsRecording(false);
      };

      ws.onclose = () => {
        socketRef.current = null;
        setIsRecording(false);
        setStatus("Idle");
      };

      ws.onopen = async () => {
        setStatus("Opening microphone...");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });

          const recorder = new RecordRTC(stream, {
            type: "audio",
            mimeType: "audio/webm;codecs=pcm_s16le",
            recorderType:
              RecordRTC.StereoAudioRecorder ||
              (RecordRTC as any).StereoAudioRecorder,
            desiredSampRate: SAMPLE_RATE,
            numberOfAudioChannels: 1,
            bufferSize: 4096,
            timeSlice: 250, // send chunks every ~250ms
            ondataavailable: (blob: Blob) => {
              if (
                socketRef.current &&
                socketRef.current.readyState === WebSocket.OPEN
              ) {
                blob.arrayBuffer().then((buffer) => {
                  socketRef.current!.send(buffer);
                });
              }
            },
          });

          recorderRef.current = recorder;
          recorder.startRecording();
          setStatus("Listening...");
        } catch (err) {
          console.error("getUserMedia error:", err);
          alert("Error accessing microphone");
          setIsRecording(false);
          setStatus("Idle");
        }
      };
    } catch (err) {
      console.error(err);
      alert("Unexpected error starting recording");
      setIsRecording(false);
      setStatus("Idle");
    }
  };

  const handleClear = () => {
    setText("");
    committedTextRef.current = "";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl bg-slate-950/60 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-md p-6 md:p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-50 flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-lg">
                🎤
              </span>
              Pro Voice to Text
            </h1>
            <p className="text-sm md:text-base text-slate-400 mt-1">
              Click <span className="font-semibold text-slate-100">Speak</span>,
              give mic permission, and start talking. Your voice is streamed to
              AssemblyAI&apos;s real-time engine and converted to text in
              <span className="font-semibold"> ~300ms chunks</span>.
            </p>
          </div>

          <div className="px-3 py-1 rounded-full text-xs font-medium border bg-slate-800/60 text-slate-300 border-slate-700">
            {status}
          </div>
        </div>

        {!isRecordRTCLoaded && (
          <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-950/40 px-4 py-2 text-xs text-amber-100">
            Loading audio recorder library…
          </div>
        )}

        {/* Text area */}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            committedTextRef.current = e.target.value;
          }}
          placeholder="Your speech will appear here..."
          className="w-full min-h-[220px] rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm md:text-base text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/40 resize-y"
        />

        <p className="mt-2 text-xs text-slate-500">
          Tip: You can also edit the text manually while the model is running.
        </p>

        {/* Controls */}
        <div className="mt-6 flex flex-col md:flex-row items-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={!isRecordRTCLoaded}
            className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition
            ${
              isRecording
                ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30"
                : "bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-lg shadow-emerald-500/30"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span className="relative flex h-3 w-3">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-70 ${
                  isRecording ? "animate-ping bg-red-300" : "bg-emerald-300"
                }`}
              ></span>
              <span
                className={`relative inline-flex h-3 w-3 rounded-full ${
                  isRecording ? "bg-red-500" : "bg-emerald-500"
                }`}
              ></span>
            </span>
            {isRecording ? "Stop listening" : "Speak"}
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 bg-slate-900/70 text-xs md:text-sm text-slate-200 hover:bg-slate-800 transition"
          >
            🧹 Clear text
          </button>

          <div className="mt-1 md:mt-0 md:ml-auto text-[11px] md:text-xs text-slate-500 text-right">
            Engine: AssemblyAI Universal-Streaming
            <br />
            Sample rate:{" "}
            <span className="font-mono text-slate-300">16 kHz</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceToTextProPage;
