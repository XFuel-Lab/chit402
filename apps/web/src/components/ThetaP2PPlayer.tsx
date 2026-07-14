/**
 * ThetaP2PPlayer — Track 3.5 + 3.4: Theta P2P SDK player with optional NFT-DRM guard
 *
 * Track 3.5: Integrates the Theta P2P JavaScript SDK, which layers P2P delivery
 *            on top of hls.js via a video.js tech plugin.
 *            Docs: https://docs.thetatoken.org/docs/theta-p2p-javascript-sdk
 *
 * Track 3.4: When `videoId` (Theta Video API ID) + `nftCollection` are provided,
 *            uses the TVA.Video DRM SDK for NFT-gated playback. The viewer must
 *            connect their MetaMask wallet; Theta's DRM server verifies NFT ownership
 *            before issuing the decryption key.
 *            Docs: https://docs.thetatoken.org/docs/theta-nft-based-drm
 *
 * Both SDKs are loaded as <script> tags (CDN) — not npm packages.
 * Falls back to a native <video> + <source> HLS tag if any SDK fails to load.
 *
 * Usage — P2P only:
 *   <ThetaP2PPlayer
 *     src="https://media.thetavideoapi.com/.../master.m3u8"
 *     internalVideoId="xfuel-intent-0xabc"
 *   />
 *
 * Usage — P2P + NFT-DRM:
 *   <ThetaP2PPlayer
 *     src="https://media.thetavideoapi.com/.../master.m3u8"
 *     videoId="video_m3jxh0abh8p6vwejd0av1p9yg2"
 *     nftCollection="0x..."
 *     networkId={365}
 *   />
 */

import { useEffect, useRef, useState, useId } from 'react';

// ── CDN Script URLs (from official Theta docs) ────────────────────────────
const VIDEOJS_JS   = 'https://vjs.zencdn.net/7.15.4/video.js';
const VIDEOJS_CSS  = 'https://vjs.zencdn.net/7.15.4/video-js.css';
const HLSJS_URL    = 'https://cdn.jsdelivr.net/npm/[email protected]';
const THETA_URL    = 'https://d1ktbyo67sh8fw.cloudfront.net/js/theta.umd.min.js';
const THETA_HLS_URL = 'https://d1ktbyo67sh8fw.cloudfront.net/js/theta-hls-plugin.umd.min.js';
const THETA_VJS_URL = 'https://d1ktbyo67sh8fw.cloudfront.net/js/videojs-theta-plugin.min.js';
// TVA DRM SDK (for NFT-based DRM — Track 3.4)
const TVA_SDK_URL  = 'https://d1ktbyo67sh8fw.cloudfront.net/js/tva.umd.min.js';

declare global {
  interface Window {
    videojs?: (id: string, opts: object) => {
      tech_: { trigger: (event: string) => void };
      dispose: () => void;
      src: (sources: object[]) => void;
    };
    Hls?: unknown;
    Theta?: unknown;
    TVA?: {
      Video: new (opts: {
        videoId: string;
        videoEl: HTMLVideoElement;
        onAccessOK?: () => void;
        onAccessDenied?: (reason?: string) => void;
        onError?: (err: unknown) => void;
        networkId?: number;
      }) => { signin: () => Promise<void>; destroy?: () => void };
    };
  }
}

interface ThetaP2PPlayerProps {
  /** HLS master playlist URL from Theta Video API */
  src: string;
  /**
   * Theta Video API video ID (e.g. "video_m3jxh0abh8p6vwejd0av1p9yg2").
   * Required for NFT-DRM (Track 3.4). Optional for P2P-only mode.
   */
  videoId?: string;
  /**
   * Your app's internal identifier for this video — used by Theta P2P for
   * peer grouping. Defaults to `videoId` if provided, else a random value.
   */
  internalVideoId?: string;
  /**
   * TNT-721 collection address. When set alongside `videoId`, the TVA DRM
   * SDK gates playback on NFT ownership.
   */
  nftCollection?: string;
  /** Theta network ID: 361 = mainnet, 365 = testnet. Defaults to testnet. */
  networkId?: 361 | 365;
  /**
   * Called when the viewer does not own the required NFT.
   * Provide a handler that guides the user to mint/purchase.
   */
  onAccessDenied?: (nftCollection: string) => void;
}

// Load a <script> tag once; re-uses existing tag if already in DOM.
function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (existing?.dataset.loaded === 'true') { resolve(); return; }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Script load failed: ${url}`)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = url; s.async = false; // preserve execution order
    s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
    s.onerror = () => reject(new Error(`Script load failed: ${url}`));
    document.head.appendChild(s);
  });
}

// Load a <link rel="stylesheet"> once.
function loadCSS(url: string) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = url;
  document.head.appendChild(l);
}

export default function ThetaP2PPlayer({
  src,
  videoId,
  internalVideoId,
  nftCollection,
  networkId = 365,
  onAccessDenied,
}: ThetaP2PPlayerProps) {
  const uid = useId().replace(/:/g, '');
  const playerId = `theta-player-${uid}`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const vjsRef = useRef<ReturnType<NonNullable<typeof window.videojs>> | null>(null);
  const tvaRef = useRef<InstanceType<NonNullable<typeof window.TVA>['Video']> | null>(null);

  const [mode, setMode] = useState<'loading' | 'p2p' | 'drm-wait' | 'drm-ok' | 'drm-denied' | 'fallback'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!src || !videoRef.current) return;
    let cancelled = false;

    const initDRM = async () => {
      if (!window.TVA || !videoRef.current || !videoId) return;
      setMode('drm-wait');
      tvaRef.current = new window.TVA.Video({
        videoId,
        videoEl: videoRef.current,
        networkId,
        onAccessOK: () => { if (!cancelled) setMode('drm-ok'); },
        onAccessDenied: () => {
          if (cancelled) return;
          setMode('drm-denied');
          onAccessDenied?.(nftCollection ?? '');
        },
        onError: (err) => {
          if (!cancelled) {
            setLoadError(String(err).slice(0, 100));
            setMode('fallback');
          }
        },
      });
    };

    const initP2P = () => {
      if (!window.videojs || !videoRef.current || cancelled) return;
      const vId = internalVideoId || videoId || `xfuel-${uid}`;
      try {
        vjsRef.current = window.videojs(playerId, {
          techOrder: ['theta_hlsjs', 'html5'],
          sources: [{ src, type: 'application/vnd.apple.mpegurl', label: '1080p' }],
          theta_hlsjs: {
            videoId: vId,
            onThetaReady: null,
            onStreamReady: null,
            thetaOpts: { allowRangeRequests: true },
          },
        });
        if (!cancelled) setMode('p2p');
      } catch (err) {
        if (!cancelled) {
          setLoadError(String(err).slice(0, 100));
          setMode('fallback');
        }
      }
    };

    const boot = async () => {
      try {
        // Must load in order: video.js → hls.js → theta → theta-hls-plugin → videojs-theta-plugin
        loadCSS(VIDEOJS_CSS);
        await loadScript(VIDEOJS_JS);
        await loadScript(HLSJS_URL);
        await loadScript(THETA_URL);
        await loadScript(THETA_HLS_URL);
        await loadScript(THETA_VJS_URL);

        if (cancelled) return;
        initP2P();

        // Layer DRM on top if videoId + nftCollection provided
        if (videoId && nftCollection) {
          await loadScript(TVA_SDK_URL);
          if (!cancelled) initDRM();
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(String(err).slice(0, 100));
          setMode('fallback');
        }
      }
    };

    boot();

    return () => {
      cancelled = true;
      try { tvaRef.current?.destroy?.(); } catch { /* ignore */ }
      try { vjsRef.current?.dispose(); } catch { /* ignore */ }
      vjsRef.current = null;
      tvaRef.current = null;
    };
  }, [src, videoId, internalVideoId, nftCollection, networkId, playerId, uid, onAccessDenied]);

  // ── NFT access denied screen ──────────────────────────────────────────────
  if (mode === 'drm-denied') {
    return (
      <div style={{
        marginTop: '1rem', borderRadius: '8px',
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
        padding: '1.5rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔒</div>
        <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: '#f87171', fontSize: '1.1rem' }}>
          NFT Access Required
        </div>
        <div style={{ fontSize: '0.85rem', color: '#8a8a9a', marginBottom: '1rem' }}>
          This content is encrypted and only accessible to holders of the linked TNT-721 collection.
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}
          onClick={() => onAccessDenied?.(nftCollection!)}
        >
          Get Access NFT →
        </button>
        {nftCollection && (
          <div style={{ fontSize: '0.7rem', color: '#55556a', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
            Collection: {nftCollection}
          </div>
        )}
      </div>
    );
  }

  // ── DRM wallet connect prompt ─────────────────────────────────────────────
  const showWalletPrompt = mode === 'drm-wait';

  return (
    <div style={{ marginTop: '1rem', borderRadius: '8px', overflow: 'hidden', background: '#000', position: 'relative' }}>
      {/* video.js uses a <video> element; we give it the id videojs targets */}
      <video
        id={playerId}
        ref={videoRef}
        controls
        className="video-js vjs-default-skin"
        style={{ width: '100%', display: 'block', maxHeight: '360px' }}
        data-setup="{}"
      >
        {/* Native HLS fallback when P2P SDKs fail to load */}
        {mode === 'fallback' && <source src={src} type="application/vnd.apple.mpegurl" />}
      </video>

      {/* Status badges */}
      <div style={{
        position: 'absolute', top: '8px', right: '8px',
        display: 'flex', gap: '0.4rem', alignItems: 'center',
      }}>
        {mode === 'loading' && (
          <span style={{
            background: 'rgba(0,0,0,0.7)', color: '#8a8a9a',
            fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
          }}>Loading…</span>
        )}
        {mode === 'p2p' && (
          <span style={{
            background: 'rgba(0,0,0,0.7)', color: '#22c55e',
            fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px',
            borderRadius: '4px', letterSpacing: '0.05em',
          }}>Θ P2P</span>
        )}
        {mode === 'drm-ok' && (
          <span style={{
            background: 'rgba(0,0,0,0.7)', color: '#22c55e',
            fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
          }}>🛡 NFT verified</span>
        )}
        {mode === 'fallback' && (
          <span style={{
            background: 'rgba(0,0,0,0.7)', color: '#f59e0b',
            fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
          }}>HLS fallback</span>
        )}
        {loadError && (
          <span style={{
            background: 'rgba(0,0,0,0.7)', color: '#f87171',
            fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px', maxWidth: '140px', overflow: 'hidden',
          }} title={loadError}>SDK error</span>
        )}
      </div>

      {/* DRM wallet connect overlay */}
      {showWalletPrompt && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.75)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
        }}>
          <div style={{ color: '#fff', fontWeight: 600 }}>Connect wallet to verify NFT ownership</div>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.85rem' }}
            onClick={() => tvaRef.current?.signin()}
          >
            Connect MetaMask
          </button>
        </div>
      )}
    </div>
  );
}
