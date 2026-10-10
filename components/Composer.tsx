'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {uploadScreenshot} from '@/lib/api';
import {fileSize} from '@/lib/format';
import {CloseIcon, ImageIcon, SendIcon} from './icons';

/**
 * The box a reply is written in. Shared by a thread and by Broadcast, because
 * both write the same kind of document and both deserve the same rules:
 *
 * - sending is disabled while there is nothing to send, and while one is in
 *   flight, so a double click can never post twice;
 * - the words are kept on a failure (the caller throws and this puts them back),
 *   because losing a half-written answer to a dropped connection is the one
 *   thing that makes an internal tool infuriating;
 * - ⌘/Ctrl + Enter sends; Enter alone is a newline, as it should be in a box
 *   that people paste stack traces into;
 * - a screenshot uploads first, and the message carries the file id — exactly
 *   the shape the phone app writes for its own attachments.
 */

type Attachment = {
  id: string;
  name: string;
  size: number;
  /** Object URL of the local file, so the chip shows the actual picture. */
  preview: string;
};

type ComposerProps = {
  placeholder: string;
  maxLength: number;
  /** Sends and resolves once the server has it; throw to keep the words. */
  onSend: (text: string, fileId: string | null) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
  /** Broadcast needs a louder button than a reply does. */
  sendLabel?: string;
};

const Composer = ({
  placeholder,
  maxLength,
  onSend,
  onError,
  disabled = false,
  sendLabel,
}: ComposerProps) => {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Object URLs hold the file in memory until they are released.
  useEffect(
    () => () => {
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
    },
    [attachment],
  );

  const pickFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }
      if (file.type && !file.type.startsWith('image/')) {
        onError('Screenshots only — that file is not an image');
        return;
      }
      setUploading(true);
      try {
        const stored = await uploadScreenshot(file);
        setAttachment({
          id: stored.id,
          name: stored.name,
          size: stored.size,
          preview: URL.createObjectURL(file),
        });
      } catch (error) {
        onError((error as Error).message || 'Could not upload that screenshot');
      } finally {
        setUploading(false);
      }
    },
    [onError],
  );

  const send = useCallback(async () => {
    const words = text.trim();
    if (disabled || sending || uploading || (!words && !attachment)) {
      return;
    }
    setSending(true);
    try {
      await onSend(words, attachment?.id ?? null);
      setText('');
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      setAttachment(null);
      textRef.current?.focus();
    } catch (error) {
      // Everything stays put — the words, the screenshot, the cursor.
      onError((error as Error).message || 'Could not send that');
    } finally {
      setSending(false);
    }
  }, [attachment, disabled, onError, onSend, sending, text, uploading]);

  const canSend = (!!text.trim() || !!attachment) && !disabled && !uploading;
  const nearlyFull = text.length > maxLength - 60;

  return (
    <div className="glass sheen relative p-3">
      {attachment ? (
        <div className="glass-soft mb-2 flex items-center gap-3 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.preview}
            alt={attachment.name}
            className="h-11 w-11 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink">{attachment.name}</p>
            <p className="text-[11px] text-ink-muted">
              {fileSize(attachment.size)} · uploads with the message
            </p>
          </div>
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => {
              if (attachment.preview) {
                URL.revokeObjectURL(attachment.preview);
              }
              setAttachment(null);
            }}
            className="focus-ring rounded-lg p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink">
            <CloseIcon size={16} />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Attach a screenshot"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet/40 bg-violet/15 text-violet-bright transition hover:bg-violet/25 disabled:opacity-50">
          {uploading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
          ) : (
            <ImageIcon size={18} />
          )}
        </button>

        <textarea
          ref={textRef}
          value={text}
          onChange={event => setText(event.target.value.slice(0, maxLength))}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          className="scroll-thin max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-violet-bright/50"
        />

        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend || sending}
          aria-label={sendLabel || 'Send reply'}
          className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
            canSend && !sending
              ? 'border border-violet-bright/60 bg-gradient-to-b from-violet to-violet-deep text-white shadow-glow'
              : 'cursor-not-allowed border border-white/10 bg-white/5 text-ink-subtle'
          }`}>
          {sending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <SendIcon size={17} />
          )}
          {sendLabel ? <span className="hidden sm:inline">{sendLabel}</span> : null}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={event => {
          void pickFile(event.target.files?.[0]);
          // Reset, so picking the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      <div className="mt-1 flex items-center justify-between px-1">
        <span className="text-[11px] text-ink-subtle">⌘/Ctrl + Enter sends</span>
        {nearlyFull ? (
          <span
            className={`text-[11px] ${text.length >= maxLength ? 'text-danger' : 'text-ink-muted'}`}>
            {text.length}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default Composer;
