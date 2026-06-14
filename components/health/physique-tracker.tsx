'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getLatestPhysiqueLog,
  getPhysiqueLogs,
  insertPhysiqueLog,
  uploadProgressPhoto,
} from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { PhysiqueLog } from '@/lib/health/storage';
import ProgressGallery from './progress-gallery';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PhysiqueTracker({ forceView }: { forceView?: 'log' | 'gallery' }) {
  const [view, setView] = useState<'log' | 'gallery'>(forceView ?? 'log');
  const [latest, setLatest] = useState<PhysiqueLog | null>(null);
  const [logs, setLogs] = useState<PhysiqueLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const todayStr = new Date().toISOString().slice(0, 10);
  const [logDate, setLogDate] = useState(todayStr);
  const [bodyweight, setBodyweight] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // File state (multi-image)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Load data
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [latestData, history] = await Promise.all([
        getLatestPhysiqueLog(),
        getPhysiqueLogs(90),
      ]);
      setLatest(latestData);
      setLogs(history);
      if (latestData?.bodyweight) setBodyweight(String(latestData.bodyweight));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load physique data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync view when forceView changes
  useEffect(() => {
    if (forceView) setView(forceView);
  }, [forceView]);

  useEffect(() => { load(); }, [load]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  function handleFiles(files: FileList | File[]) {
    const valid: File[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        setError(`${file.name} is not an image.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} is over 10 MB.`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length === 0) return;
    // Revoke old previews
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setSelectedFiles((prev) => [...prev, ...valid]);
    setPreviewUrls((prev) => [...prev, ...valid.map((f) => URL.createObjectURL(f))]);
    setError(null);
    setUploadProgress('idle');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(previewUrls[index]);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function clearFiles() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setSelectedFiles([]);
    setPreviewUrls([]);
    setUploadProgress('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedFiles.length === 0 && !bodyweight) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const uploadCount = selectedFiles.length;
      let uploaded = 0;
      const created_at = logDate !== todayStr ? new Date(logDate + 'T12:00:00').toISOString() : undefined;

      // Upload images sequentially, create one row per image
      for (const file of selectedFiles) {
        setUploadProgress('uploading');
        const url = await uploadProgressPhoto(file);
        if (!url) {
          setError('Failed to upload image. Check Supabase Storage setup.');
          setSaving(false);
          setUploadProgress('idle');
          return;
        }
        uploaded++;

        const result = await insertPhysiqueLog({
          bodyweight: uploaded === 1 && bodyweight ? Number(bodyweight) : null,
          photo_url: url,
          notes: uploaded === 1 ? notes : '',
          created_at,
        });

        if (!result.data) {
          setError(result.error || 'Not signed in — data cannot be saved.');
          setSaving(false);
          setUploadProgress('idle');
          return;
        }
      }

      // If no images, just save bodyweight + notes once
      if (selectedFiles.length === 0 && bodyweight) {
        const result = await insertPhysiqueLog({
          bodyweight: Number(bodyweight),
          photo_url: '',
          notes,
          created_at,
        });
        if (!result.data) {
          setError(result.error || 'Not signed in — data cannot be saved.');
          setSaving(false);
          return;
        }
      }

      setUploadProgress('done');
      setSuccess(uploadCount > 0 ? `${uploadCount} photo${uploadCount > 1 ? 's' : ''} saved ✓` : 'Progress saved ✓');
      setTimeout(() => setSuccess(null), 2500);
      setNotes('');
      setLogDate(todayStr);
      clearFiles();
      notifyHealthDataSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
      setUploadProgress('idle');
    }
  }

  // Weight history
  const weightHistory = logs
    .filter((l) => l.bodyweight != null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-10);

  const weightChange =
    weightHistory.length >= 2
      ? Number(weightHistory[weightHistory.length - 1].bodyweight) - Number(weightHistory[0].bodyweight)
      : 0;

  return (
    <div className="space-y-4">
      {/* Status messages */}
      {error && (
        <p className="rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-400">{error}</p>
      )}
      {success && (
        <p className="rounded-lg bg-emerald-950/40 px-3 py-2 text-xs text-emerald-400">{success}</p>
      )}

      {/* View toggle: LOG | GALLERY (hidden when forceView is set) */}
      {!forceView && (
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
          <button
            onClick={() => setView('log')}
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-200 ${
              view === 'log'
                ? 'bg-cyan-600/20 text-cyan-300 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Log
          </button>
          <button
            onClick={() => setView('gallery')}
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-200 ${
              view === 'gallery'
                ? 'bg-cyan-600/20 text-cyan-300 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Gallery
          </button>
        </div>
      )}

      {view === 'log' ? (
        <>
          {/* LOG VIEW — existing form + weight history */}
          {/* Current weight + latest photo */}
          {latest && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                  Latest Check-in
                </span>
                <span className="text-[10px] text-zinc-500">{formatFullDate(latest.created_at)}</span>
              </div>
              {latest.bodyweight != null && (
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-zinc-100">{latest.bodyweight}</span>
                  <span className="text-xs text-zinc-500">kg</span>
                  {weightChange !== 0 && (
                    <span
                      className={`text-xs font-medium ${
                        weightChange > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {weightChange > 0 ? '+' : ''}
                      {weightChange.toFixed(1)} kg
                    </span>
                  )}
                </div>
              )}
              {latest.photo_url && (
                <div className="mt-2">
                  <img
                    src={latest.photo_url}
                    alt="Latest progress"
                    className="h-24 w-24 rounded-lg border border-zinc-700 object-cover"
                  />
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Image upload zone */}
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Progress Photo <span className="font-normal lowercase text-zinc-600">(optional)</span>
              </label>

              {/* Drop zone / preview thumbnails */}
              {previewUrls.length > 0 ? (
                <div className="mb-2 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {previewUrls.map((url, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-800/30">
                        <img
                          src={url}
                          alt={`Preview ${i + 1}`}
                          className="aspect-square w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          disabled={saving}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/70 text-[9px] text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          ✕
                        </button>
                        {uploadProgress === 'uploading' && saving && (
                          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
                          </div>
                        )}
                      </div>
                    ))}
                    {/* Add more button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={saving}
                      className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-zinc-700/40 bg-zinc-800/10 text-xl text-zinc-500 transition-colors hover:border-zinc-600/60 hover:bg-zinc-800/30"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-600">{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected</p>
                </div>
              ) : (
                <div
                  ref={dropRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition-all ${
                    dragOver
                      ? 'border-cyan-500/60 bg-cyan-500/5'
                      : 'border-zinc-700/40 bg-zinc-800/20 hover:border-zinc-600/60 hover:bg-zinc-800/40'
                  }`}
                >
                  <span className="text-2xl">📸</span>
                  <p className="text-xs text-zinc-400">
                    {dragOver ? 'Drop images here' : 'Click or drag images'}
                  </p>
                  <p className="text-[10px] text-zinc-600">JPG, PNG, WEBP — max 10 MB each</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              )}
            </div>

            {/* Date picker */}
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Date
              </label>
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                max={todayStr}
                className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-0 [color-scheme:dark]"
              />
            </div>

            {/* Bodyweight */}
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Bodyweight <span className="font-normal lowercase text-zinc-600">(optional)</span>
              </label>
              <input
                type="number"
                step={0.1}
                min={30}
                max={300}
                placeholder="e.g. 75.5"
                value={bodyweight}
                onChange={(e) => setBodyweight(e.target.value)}
                className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-0"
              />
            </div>

            {/* Notes */}
            <div>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-0"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={saving || (selectedFiles.length === 0 && !bodyweight)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {uploadProgress === 'uploading' ? 'Uploading...' : 'Saving...'}
                </span>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  {selectedFiles.length > 0 || bodyweight ? 'Save Check-in' : 'Skip'}
                </>
              )}
            </button>
          </form>

          {/* Weight history */}
          {weightHistory.length > 1 && (
            <section>
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Weight History
              </h2>
              <div className="space-y-1">
                {weightHistory
                  .slice(-7)
                  .reverse()
                  .map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2"
                    >
                      <span className="text-xs text-zinc-400">{formatDate(log.created_at)}</span>
                      <span className="text-sm font-medium text-zinc-200">{log.bodyweight} kg</span>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <ProgressGallery logs={logs} onRefresh={() => load()} />
      )}

      {/* Loading (log view only — gallery manages its own loading state) */}
      {view === 'log' && loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        </div>
      )}
    </div>
  );
}
