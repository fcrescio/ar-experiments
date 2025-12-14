export function createRecorder(audioContext, setStatus) {
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let recordingTarget = null;

  async function startRecordingFor(note) {
    if (!navigator.mediaDevices?.getUserMedia || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      recordingTarget = note;
      mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });
          const buffer = await blob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
          note.userData.audioBuffer = audioBuffer;
          setStatus?.(`Recorded audio for ${note.userData.label}.`);
        } catch (err) {
          console.error(err);
          setStatus?.('Failed to decode recorded audio.');
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      };
      mediaRecorder.start();
      isRecording = true;
      setStatus?.(`Recording on ${note.userData.label}...`);
    } catch (err) {
      console.error(err);
      setStatus?.('Could not start recording. Microphone permission is required.');
    }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    mediaRecorder.stop();
    isRecording = false;
    recordingTarget = null;
  }

  function stopIfTarget(mesh) {
    if (recordingTarget === mesh) stopRecording();
  }

  return {
    startRecordingFor,
    stopRecording,
    stopIfTarget,
    isRecording: () => isRecording,
    get recordingTarget() {
      return recordingTarget;
    }
  };
}
