export function createRecorder(audioContext, setStatus, {
  onRecordingFinished,
  updateRecordingUI,
  onRecordingStopped,
  setRecordingVisual,
  notify
} = {}) {
  let mediaRecorder = null;
  let mediaStream = null;
  let recordedChunks = [];
  let isRecording = false;
  let recordingTarget = null;
  let recordingStart = null;
  let canceled = false;

  async function startRecordingFor(note) {
    if (!navigator.mediaDevices?.getUserMedia || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      canceled = false;
      mediaStream = stream;
      mediaRecorder = new MediaRecorder(stream);
      recordingTarget = note;
      recordingStart = performance.now();
      mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          if (!canceled && recordedChunks.length) {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const buffer = await blob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
            note.userData.audioBuffer = audioBuffer;
            note.userData.audioBlob = blob;
            setStatus?.(`Recorded audio for ${note.userData.label}.`);
            onRecordingFinished?.(note);
          } else if (canceled) {
            setStatus?.('Recording canceled.');
          }
        } catch (err) {
          console.error(err);
          setStatus?.('Failed to decode recorded audio.');
          notify?.('Failed to decode audio', 'error');
        } finally {
          mediaStream?.getTracks().forEach((t) => t.stop());
          mediaStream = null;
          setRecordingVisual?.(note, false);
          updateRecordingUI?.({ active: false });
        }
      };
      mediaRecorder.start();
      isRecording = true;
      setRecordingVisual?.(note, true);
      updateRecordingUI?.({ active: true, label: note.userData.label });
      setStatus?.(`Recording on ${note.userData.label}...`);
      notify?.(`Recording on ${note.userData.label}`);
    } catch (err) {
      console.error(err);
      setStatus?.('Could not start recording. Microphone permission is required.');
      notify?.('Mic permission denied or unavailable', 'error');
    }
  }

  function stopRecording(opts = {}) {
    if (!isRecording || !mediaRecorder) return;
    canceled = !!opts.canceled;
    mediaRecorder.stop();
    isRecording = false;
    recordingTarget = null;
    recordingStart = null;
    onRecordingStopped?.();
    if (canceled) {
      notify?.('Recording canceled', 'warn');
    }
  }

  function stopIfTarget(mesh) {
    if (recordingTarget === mesh) stopRecording();
  }

  function isRecordingActive() {
    return isRecording;
  }

  function update(time) {
    if (!isRecording || !recordingTarget) return;
    const elapsed = recordingStart ? (time - recordingStart) / 1000 : 0;
    updateRecordingUI?.({ active: true, label: recordingTarget.userData.label, elapsed });
  }

  return {
    startRecordingFor,
    stopRecording,
    stopIfTarget,
    isRecording: isRecordingActive,
    update,
    cancel: () => stopRecording({ canceled: true }),
    get recordingTarget() {
      return recordingTarget;
    }
  };
}
