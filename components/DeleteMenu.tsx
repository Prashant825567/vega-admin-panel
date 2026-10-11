'use client';

import {useEffect} from 'react';
import {TrashIcon, CloseIcon, EyeOffIcon} from './icons';

/**
 * The one question a delete has to ask before it does anything: who loses it.
 *
 * WhatsApp asks because the two answers are genuinely different, and so are
 * these:
 *
 * - **Delete for everyone** removes the document. The person who wrote it, the
 *   phone it arrived on, and this panel all lose it, and nothing brings it back.
 * - **Delete for me** hides it from the team's own view — this panel, the inbox,
 *   the unread count. The message itself is untouched, so the user still has it
 *   on their phone, exactly as if nobody had done anything.
 *
 * Getting this wrong in the destructive direction cannot be undone, which is why
 * the safe answer is the first one under the cursor, why the other one says what
 * it will *not* do, and why Escape and a click outside both mean cancel.
 */

type DeleteMenuProps = {
  /** What is being deleted, in the caller's words: "this message", "3 messages". */
  label: string;
  /** True for an announcement, which is one shared document everyone reads. */
  broadcast?: boolean;
  onCancel: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
};

const DeleteMenu = ({
  label,
  broadcast = false,
  onCancel,
  onDeleteForMe,
  onDeleteForEveryone,
}: DeleteMenuProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${label}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onCancel}>
      <div
        className="glass sheen w-full max-w-md p-5"
        onClick={event => event.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-danger/40 bg-danger/10">
            <TrashIcon size={18} className="text-danger" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black text-ink">Delete {label}?</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Choose who loses it. This cannot be undone for the first one.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            className="focus-ring shrink-0 rounded-lg p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={onDeleteForMe}
            className="focus-ring flex w-full items-start gap-3 rounded-xl2 border border-violet-bright/40 bg-violet/15 p-3 text-left transition hover:bg-violet/25">
            <EyeOffIcon size={17} className="mt-0.5 shrink-0 text-violet-bright" />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">
                Delete for me
              </span>
              <span className="mt-0.5 block text-[11px] text-ink-muted">
                Hidden on the team&apos;s side only. The person who wrote it keeps
                it on their phone, and you can put it back.
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={onDeleteForEveryone}
            className="focus-ring flex w-full items-start gap-3 rounded-xl2 border border-danger/40 bg-danger/10 p-3 text-left transition hover:bg-danger/20">
            <TrashIcon size={17} className="mt-0.5 shrink-0 text-danger" />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">
                Delete for everyone
              </span>
              <span className="mt-0.5 block text-[11px] text-ink-muted">
                {broadcast
                  ? 'Removed from the store entirely. Every user who has not opened it yet never will.'
                  : 'Removed from the store entirely — from this thread and from the user’s own chat. Nothing brings it back.'}
              </span>
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="focus-ring mt-3 w-full rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-semibold text-ink-muted transition hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
};

export default DeleteMenu;
