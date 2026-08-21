"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough for a real message, short enough to stay inside the size cap. */
const MAX_SECONDS = 300;

/** Safari only speaks mp4/aac; everything else prefers Opus in WebM. */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export interface RecordedClip {
  blob: Blob;
  mime: string;
  duration: number;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Resolved on the first client render. During the static prerender there is
  // no navigator, so assume yes and let the browser correct it.
  const [supported] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return (
      Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined"
    );
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);

  // Tick the visible timer, and stop us running past the cap.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorderRef.current?.stop();
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      // Denied permission, or no microphone on this device.
      setError("Couldn't access the microphone. Check the site's permissions.");
      releaseStream();
    }
  }, [releaseStream]);

  /** Resolves with the clip, or null if nothing usable was captured. */
  const stop = useCallback(async (): Promise<RecordedClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return null;

    const clip = await new Promise<RecordedClip | null>((resolve) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        const duration = (Date.now() - startedAtRef.current) / 1000;
        resolve(blob.size > 0 ? { blob, mime, duration } : null);
      };
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(null);
    });

    releaseStream();
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
    return clip;
  }, [releaseStream]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseStream();
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  }, [releaseStream]);

  // Never leave the mic hot if the tab closes mid-recording.
  useEffect(() => releaseStream, [releaseStream]);

  return { recording, seconds, error, supported, start, stop, cancel, maxSeconds: MAX_SECONDS };
}
