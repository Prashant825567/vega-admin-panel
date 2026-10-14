'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import AmbientBackground from '@/components/AmbientBackground';
import Rail, {type ViewKey} from '@/components/Rail';
import InboxView from '@/components/InboxView';
import ThreadView from '@/components/ThreadView';
import BroadcastView from '@/components/BroadcastView';
import LiveView from '@/components/LiveView';
import UsersView from '@/components/UsersView';
import PulseView from '@/components/PulseView';
import {RefreshIcon, SearchIcon} from '@/components/icons';
import {HEARTBEAT_MS} from '@/lib/contract';
import {
  announcePanel,
  announcePanelAway,
  getPresence,
  type PresencePayload,
} from '@/lib/api';
import {usePoll} from '@/hooks/usePoll';
import {useKeyboard} from '@/hooks/useKeyboard';

/**
 * The console itself: the rail, the header, and whichever screen is open.
 *
 * It owns the three things every screen has to agree on —
 *
 *   presence  who is online, and the panel's own heartbeat (the write that makes
 *             the phone app's chat header say "Online now")
 *   unread    the number on the rail, which the inbox reports up as it loads
 *   refresh   one button that re-reads whatever is on screen, because every
 *             screen is polling and none of them should own the header
 *
 * and it owns the one thing nobody else should: the toast. A screen that fails
 * says so through `notify` and carries on showing what it already had.
 */

type Toast = {id: number; message: string; tone: 'ok' | 'danger'};

const App = () => {
  const [view, setView] = useState<ViewKey>('inbox');
  const [chatId, setChatId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [announcements, setAnnouncements] = useState(0);
  const [presence, setPresence] = useState<PresencePayload | null>(null);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // The strip of the page a phone is actually showing. Shut on a desktop, and
  // shut on the server — see hooks/useKeyboard.
  const keyboard = useKeyboard();

  const notify = useCallback((message: string, tone: 'ok' | 'danger' = 'ok') => {
    setToast({id: Date.now(), message, tone});
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * Say goodbye the moment the console stops being looked at.
   *
   * The heartbeat below stops while the tab is hidden (hooks/usePoll does not
   * poll what nobody is reading), and without this the phone app would keep
   * showing "Online now" until the window expired — a panel that is closed is
   * the one presence question the panel itself can answer instantly.
   *
   * `pagehide` is the reliable one (it fires for a close, a reload and a
   * navigation away, where `unload` is not dependable on mobile browsers), and
   * `visibilitychange` covers the tab switch, which is the same thing as far as
   * "is anybody at the keyboard" goes. Coming back re-beats at once — the hook
   * refreshes on the way in — so being briefly hidden costs nothing.
   */
  useEffect(() => {
    const leave = () => announcePanelAway();
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        leave();
      }
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', onHidden);
      leave();
    };
  }, []);

  /**
   * One round of presence: write our own heartbeat, then read who is around.
   * The write comes first on purpose — the app's "Online now" should be true for
   * as long as the panel is open, not a round behind it.
   */
  usePoll(
    async () => {
      try {
        await announcePanel();
        return await getPresence();
      } catch (failure) {
        setPresenceError(
          (failure as Error).message || 'Could not read who is online',
        );
        throw failure;
      }
    },
    HEARTBEAT_MS,
    {
      onResult: result => {
        setPresence(result);
        setPresenceError(null);
      },
    },
  );

  const onlineSet = useMemo(
    () => new Set((presence?.users ?? []).map(entry => entry.user)),
    [presence],
  );
  const onlineCount = presence?.onlineCount ?? 0;

  const openChat = useCallback((next: string) => {
    setChatId(next);
    setView('inbox');
  }, []);

  const refreshActive = useCallback(() => {
    setRefreshSignal(signal => signal + 1);
    if (chatId) {
      notify('Refreshing the thread…');
    }
  }, [chatId, notify]);

  const thread = chatId ? (
    <ThreadView
      chatId={chatId}
      online={onlineSet.has((chatId.replace(/^chat_/, '') || '').toLowerCase())}
      onBack={() => setChatId(null)}
      notify={notify}
      refreshSignal={refreshSignal}
    />
  ) : null;

  const inbox = (
    <InboxView
      online={onlineSet}
      activeChatId={chatId}
      onOpen={setChatId}
      query={query}
      unreadOnly={unreadOnly}
      onToggleUnreadOnly={() => setUnreadOnly(value => !value)}
      refreshSignal={refreshSignal}
      onTotals={setUnread}
      compact={false}
    />
  );

  return (
    // The console is exactly one viewport tall and never scrolls as a whole:
    // every screen scrolls inside itself. `100dvh` is the small-viewport height
    // on a phone (browser chrome included), which is what stops the composer
    // from ending up under the address bar — and the `h-screen` class is the
    // fallback for a browser that does not know `dvh` at all.
    //
    // It is `fixed` on purpose: a page in normal flow can be scrolled by the
    // browser itself — and a mobile browser opening a keyboard is exactly when
    // it does that — which carried the header off the top and the composer off
    // the bottom of a console that is not supposed to scroll at all. Pinned, and
    // with the document's own overflow hidden (globals.css), nothing outside
    // this box can move it. While a keyboard is up the box shrinks to the strip
    // above it, so the composer rises with the keyboard the way a messenger's
    // does, instead of hiding underneath it.
    <div
      className="fixed inset-x-0 top-0 flex h-screen flex-col overflow-hidden"
      style={
        keyboard.open
          ? {top: keyboard.top, height: keyboard.height}
          : {height: '100dvh'}
      }>
      <AmbientBackground />

      {/* `min-h-0` is load-bearing: without it this row is free to grow past the
          viewport to fit its tallest child, and everything below the fold — the
          composer first — is what pays for it. The bottom padding clears the
          mobile nav, which floats 12px off the bottom edge. */}
      <div
        className={`mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 gap-4 p-3 md:p-4 md:pb-4 ${
          // The 6rem clears the floating mobile nav — except while a keyboard is
          // up, when that nav is out of the way and every pixel is the thread's.
          keyboard.open
            ? 'pb-3'
            : 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
        }`}>
        <Rail
          active={view}
          navHidden={keyboard.open}
          onChange={next => {
            setView(next);
            if (next !== 'inbox') {
              setChatId(null);
            }
          }}
          unread={unread}
          online={onlineCount}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* The header: who we are, how many are online, and one refresh. */}
          <header className="glass rim sheen relative flex flex-wrap items-center gap-3 p-3">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black text-white"
                style={{
                  background: 'linear-gradient(140deg, #7C4DFF, #00C6FF)',
                  boxShadow: '0 10px 26px rgba(124,77,255,0.38)',
                }}>
                V
              </span>
              <div className="leading-tight">
                <p className="text-sm font-black tracking-tight text-ink">
                  Vega Support Console
                </p>
                <p className="text-[11px] text-ink-muted">
                  {presence?.panelHandle
                    ? `announcing as ${presence.panelHandle}`
                    : 'connecting…'}
                  {announcements > 0 ? ` · ${announcements} announcements` : ''}
                </p>
              </div>
            </div>

            <label className="order-last flex min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 sm:order-none">
              <SearchIcon size={15} className="shrink-0 text-ink-subtle" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onFocus={() => setView('inbox')}
                placeholder="Search an email or a message…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
              />
            </label>

            <button
              type="button"
              onClick={() => setView('live')}
              className="focus-ring flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:text-ink">
              <span className={onlineCount > 0 ? 'dot-online' : 'dot-idle'} />
              {onlineCount} online
            </button>

            <button
              type="button"
              onClick={refreshActive}
              aria-label="Refresh this screen"
              className="focus-ring rounded-xl border border-white/10 bg-white/5 p-2 text-ink-muted transition hover:text-ink">
              <RefreshIcon size={16} />
            </button>
          </header>

          {presenceError ? (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              Presence is failing: {presenceError}
            </p>
          ) : null}

          {/* The screens. A thread sits beside the list on a wide screen and
              replaces it on a narrow one. */}
          {view === 'inbox' ? (
            chatId ? (
              <div className="flex min-h-0 flex-1 gap-4">
                <div className="hidden min-h-0 w-[320px] shrink-0 flex-col lg:flex">
                  <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
                    <InboxView
                      online={onlineSet}
                      activeChatId={chatId}
                      onOpen={setChatId}
                      query={query}
                      unreadOnly={unreadOnly}
                      onToggleUnreadOnly={() => setUnreadOnly(value => !value)}
                      refreshSignal={refreshSignal}
                      onTotals={setUnread}
                      compact
                    />
                  </div>
                </div>
                {/* A flex box, so the thread stretches to the row's height
                    instead of being measured by its own content. */}
                <div className="flex min-h-0 min-w-0 flex-1">{thread}</div>
              </div>
            ) : (
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
                {inbox}
              </div>
            )
          ) : null}

          {view === 'live' ? (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
              <LiveView
                presence={presence}
                error={presenceError}
                onOpenChat={openChat}
              />
            </div>
          ) : null}

          {view === 'users' ? (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
              <UsersView onOpenChat={openChat} refreshSignal={refreshSignal} />
            </div>
          ) : null}

          {view === 'broadcast' ? (
            <div className="min-h-0 flex-1">
              <BroadcastView
                notify={notify}
                refreshSignal={refreshSignal}
                onCount={setAnnouncements}
              />
            </div>
          ) : null}

          {view === 'pulse' ? (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
              <PulseView online={onlineCount} />
            </div>
          ) : null}
        </main>
      </div>

      {toast ? (
        <div
          role="status"
          key={toast.id}
          className={`animate-rise fixed bottom-24 right-4 z-50 max-w-sm rounded-xl2 border px-4 py-3 text-sm shadow-glass md:bottom-6 ${
            toast.tone === 'danger'
              ? 'border-danger/40 bg-danger/15 text-danger'
              : 'border-violet-bright/40 bg-violet/20 text-ink'
          }`}
          style={{backdropFilter: 'blur(18px)'}}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
};

export default App;
