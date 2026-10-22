/**
 * PreviewPanel.tsx — the Studio screen preview and controls.
 *
 *  Header    a quick toggle for the church logo.
 *  Screen    one big monitor: what the congregation sees. "Preview" flips it to what is next.
 *  Buttons   Preview | Send to Screen (Space) with a menu (Preview first / Straight to screen, Logo,
 *            Previous / Next) | Clear | bigger view.
 *  Display   Full Screen / Lower Third tiles, and a small Options box (Fade / Cut, text size).
 *  Below     the Theme strip and the Camera card (passed in as children).
 *  Compare   (Bible) the previewed verse in every installed translation (button in the Bible bar).
 */
import { useEffect, useRef, useState } from "react";
import TextSettingsCard from "./TextSettingsCard";
import type { StudioTextLook } from "../textLook";
import { CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, Zap, Expand, Image as ImageIcon, Monitor, MonitorOff, MonitorPlay, PanelBottom, Pencil, X } from "../../components/icons/NativeIcons";
import StudioModal from "./StudioModal";
import StudioMenu, { menuAt, type StudioMenuState } from "./StudioMenu";
import type { BibleTheme } from "../../bible/types";
import type { StudioCameraLayout, StudioMode, StudioScreen, StudioSlide, StudioTransition } from "../studioEngine";

/** The camera as drawn on a monitor: the Studio's own picture, so the camera is opened only once. */
export interface CamOverlay {
  enabled: boolean;
  layout: StudioCameraLayout;
  stream: MediaStream | null;
}

function CamVideo({ cam }: { cam: CamOverlay }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    video.srcObject = cam.stream;
    if (cam.stream) void video.play().catch(() => undefined);
    return undefined;
  }, [cam.stream]);
  return (
    <div className={`st-frame__cam st-frame__cam--${cam.layout}`} aria-hidden="true">
      {cam.stream ? <video ref={ref} muted playsInline /> : <span>CAMERA</span>}
    </div>
  );
}

/** A 1920×1080 page scaled to fit its box, so the monitor looks exactly like the screen. */
export function ScaledFrame({ src, title, cam }: { src: string; title: string; cam?: CamOverlay }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const update = () => setScale(Math.max(0.05, box.clientWidth / 1920));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const showCam = Boolean(cam && cam.enabled && cam.layout !== "hidden");
  // With a camera overlay the page is told not to open the camera itself and to stay transparent.
  const frameSrc = cam && src ? `${src}${src.includes("?") ? "&" : "?"}nocam=1` : src;
  return (
    <div ref={boxRef} className="studio-frame st-frame">
      {showCam && cam && cam.layout !== "in-front" && <CamVideo cam={cam} />}
      {frameSrc && <iframe title={title} src={frameSrc} tabIndex={-1} style={{ transform: `scale(${scale})` }} />}
      {showCam && cam && cam.layout === "in-front" && <CamVideo cam={cam} />}
      {/* Catches clicks so right-click opens the Studio menu, not the webview's "Inspect" menu. */}
      <div className="studio-frame__shield" aria-hidden="true" />
    </div>
  );
}

export type PreviewTab = "preview" | "alternate";

export interface CompareRow {
  translation: string;
  text: string;
}

interface PreviewPanelProps {
  tab: PreviewTab;
  onTab: (tab: PreviewTab) => void;
  /** An alternate output is running: only then is there an Alternate tab. */
  alternateOpen: boolean;
  previewUrl: string;
  alternateUrl: string;
  canUseAlternateOutput: boolean;
  onUpgradeAlternate: () => void;
  previewSlide: StudioSlide | null;
  liveSlide: StudioSlide | null;
  screen: StudioScreen;
  displayMode: StudioMode;
  onDisplayMode: (mode: StudioMode) => void;
  alternateMode: StudioMode;
  onAlternateMode: (mode: StudioMode) => void;
  /** Bible / Worship / Notes have looks; pictures and videos don't. */
  hasLook: boolean;
  currentTheme: BibleTheme | null;
  onOpenThemes: () => void;
  transition: StudioTransition;
  onTransition: (value: StudioTransition) => void;
  textScale: number;
  onTextScale: (percent: number) => void;
  textBold: boolean;
  textItalic: boolean;
  onTextBold: (on: boolean) => void;
  onTextItalic: (on: boolean) => void;
  /** Colour, shadow, alignment and background on top of the theme. */
  textLook: StudioTextLook;
  onTextLook: (patch: Partial<StudioTextLook>) => void;
  onMonitorMenu: (feed: "preview" | "program" | "alt", event: React.MouseEvent<HTMLDivElement>) => void;
  /** Playback bars for the video / sound on the screen (shown under the screen). */
  playback?: React.ReactNode;
  /** A short line when something hides the words on the screen (e.g. Camera Only). */
  notice?: string;
  /** "Preview first" (check it, then Go Live) or "Straight to screen" (what you pick goes live at once). */
  previewFirst: boolean;
  onPreviewFirst: (value: boolean) => void;
  /** Go Live (big, beside Preview) and Clear (kept apart from it). */
  canGoLive: boolean;
  onGoLive: () => void;
  onClear: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Black screen stays on the B key and the right-click menu; it has no button here. */
  blackOn?: boolean;
  onBlack?: () => void;
  /** The logo on the screen (button at the top). */
  logoOn: boolean;
  onLogo: () => void;
  canSchedule: boolean;
  onSchedule: () => void;
  /** The next schedule item, shown as a one-click button ("N" key). Hidden while the Schedule is open. */
  nextLabel?: string;
  onNextItem?: () => void;
  /** The camera as arranged in Preview, and as it is on the screen now. */
  previewCam?: CamOverlay;
  liveCam?: CamOverlay;
  /** The camera card: sits under the Show Bible / Text card. */
  cameraCard?: React.ReactNode;
  /** The Theme card: sits next to Text Settings. */
  themeCard?: React.ReactNode;
  /** "What's on the screen" (Bible / Camera / Camera + lower third). Replaces the words switch and look tiles. */
  scenePicker?: React.ReactNode;
  /** Media and Docs fill the screen on their own: no "What's on the screen" card there. */
  hideWordsCard?: boolean;
  /** A broadcast graphic is on the screen: shown above the picker with a button to take it off. */
  graphicLive?: { name: string } | null;
  onCloseGraphic?: () => void;
  /** "Show Bible / Lyrics / Text": the words are on the screen or hidden. */
  wordsOn: boolean;
  /** The camera is off, so Show Bible / Text stays on and its switch is disabled. */
  wordsLocked?: boolean;
  onWords: (on: boolean) => void;
  wordsLabel: string;
  /** More under the Display / Camera row (the theme strip). */
  children?: React.ReactNode;
  /** A document page is showing: the mouse wheel over the monitor scrolls it (deltaY in pixels). */
  onWheelScroll?: (deltaY: number) => void;
  /** A tall page fills the screen: a scrollbar on the monitor moves it on the Preview and on the Output together (0 top, 100 bottom). */
  pageScroll?: { value: number; onChange: (percent: number) => void } | null;
  /** Opens the logo settings (choose, size, background). */
  onEditLogo?: () => void;
}

/** A slim vertical scrollbar drawn over the monitor. Drag the thumb or click the track. */
function PageScroller({ value, onChange }: { value: number; onChange: (percent: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const move = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    onChange(Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)));
  };
  return (
    <div
      className="st-pagescroll"
      role="scrollbar"
      aria-orientation="vertical"
      aria-label="Scroll the page on the Preview and the Output"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title="Scroll the page (also: mouse wheel over the screen)"
      ref={trackRef}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e.clientY); }}
      onPointerMove={(e) => { if (e.buttons === 1) move(e.clientY); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); onChange(Math.min(100, value + 5)); }
        if (e.key === "ArrowUp") { e.preventDefault(); onChange(Math.max(0, value - 5)); }
      }}
    >
      <span className="st-pagescroll__thumb" style={{ top: `${value * 0.78}%` }} />
    </div>
  );
}

function slideName(slide: StudioSlide | null): string {
  if (!slide) return "";
  return slide.reference || `${slide.itemTitle}${slide.label ? ` · ${slide.label}` : ""}`;
}

export default function PreviewPanel(props: PreviewPanelProps) {
  const { tab, onTab, previewSlide, liveSlide, screen, hasLook } = props;
  const [max, setMax] = useState(false);
  const [menu, setMenu] = useState<StudioMenuState | null>(null);

  const liveText = screen === "black" ? "Black screen" : screen === "logo" ? "Logo" : slideName(liveSlide) || "Nothing on the screen";
  const hasLive = Boolean(liveSlide) || screen !== "live";
  const onAir = hasLive || Boolean(props.liveCam?.enabled);
  // Words off: the look (Full Screen / Lower Third, Fade / Cut, text size) has nothing to do.
  const wordsOff = !props.wordsOn;
  const isAlternate = tab === "alternate" && props.alternateOpen;
  const isLiveFeed = isAlternate;
  const showFrame = true;
  const frameUrl = isAlternate ? props.alternateUrl : props.previewUrl;
  const frameTitle = isAlternate ? "Alternate output" : "Preview";
  const contextFeed = isAlternate ? "alt" : "preview";

  const openSendMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu(menuAt({ clientX: rect.right - 215, clientY: rect.bottom + 6 }, [
      { label: "Preview first", icon: props.previewFirst ? <Check size={14} /> : <Eye size={14} />, hint: props.previewFirst ? "On" : undefined, onSelect: () => props.onPreviewFirst(true) },
      { label: "Straight to screen", icon: !props.previewFirst ? <Check size={14} /> : <Zap size={14} />, hint: !props.previewFirst ? "On" : undefined, onSelect: () => props.onPreviewFirst(false) },
      { label: "Previous on the screen", icon: <ChevronLeft size={14} />, divider: true, hint: "Page Up", onSelect: props.onPrev },
      { label: "Next on the screen", icon: <ChevronRight size={14} />, hint: "Page Down", onSelect: props.onNext },
    ]));
  };

  return (
    <section className="st-preview st-lo" aria-label="Studio screen">
      <div className="st-lo__head">
        <div className="st-lo__feedtabs" role="tablist" aria-label="Studio output preview">
          <button type="button" role="tab" aria-selected={!isAlternate} className={!isAlternate ? "is-on" : ""} onClick={() => onTab("preview")} title="Preview the next slide">
            <Eye size={14} /><span>Preview</span>
          </button>
          {props.alternateOpen && (
            <button type="button" role="tab" aria-selected={isAlternate} className={isAlternate ? "is-on" : ""} onClick={() => onTab("alternate")} title="Alternate output">
              <MonitorPlay size={14} /><span>Alternate</span>
            </button>
          )}
        </div>
        <div className="st-lo__logogrp">
          <button type="button" className={`st-lo__logo${props.logoOn ? " is-on" : ""}`} onClick={props.onLogo} aria-pressed={props.logoOn} title={props.logoOn ? "Hide the church logo" : "Show the church logo on the screen"}>
            <ImageIcon size={13} /> <span>Logo</span>
          </button>
          {props.onEditLogo && (
            <button type="button" className="st-lo__logo st-lo__logoedit" onClick={props.onEditLogo} title="Edit the logo: choose a picture, size and background" aria-label="Edit the logo">
              <Pencil size={12} /> <span>Edit</span>
            </button>
          )}
        </div>
      </div>

      <div className="st-preview__stage">
        {showFrame && (
          <div className={`st-monitor${isLiveFeed ? " is-output" : ""}`} onWheel={props.onWheelScroll ? (e) => props.onWheelScroll?.(e.deltaY) : undefined} onContextMenu={(e) => props.onMonitorMenu(contextFeed, e)}>
            <ScaledFrame title={frameTitle} src={frameUrl} cam={isLiveFeed ? props.liveCam : props.previewCam} />
            {props.pageScroll && <PageScroller value={props.pageScroll.value} onChange={props.pageScroll.onChange} />}
            {isLiveFeed && !hasLive && !props.liveCam?.enabled && (
              <span className="st-livemini__empty" aria-label="Nothing live yet"><MonitorOff size={22} /></span>
            )}
            <div className="st-monitor__label">
              {isLiveFeed ? <span className="st-tag st-tag--live">LIVE</span> : <span className="st-tag st-tag--prev">PREVIEW</span>}
              <span className="st-monitor__name">{isLiveFeed ? liveText : slideName(previewSlide) || "Click something to preview it"}</span>
              {tab === "preview" && <em className="st-monitor__hint">next · not on the screen yet</em>}
              <span className="st-monitor__tools">
                <button type="button" className="st-iconbtn st-iconbtn--sm" disabled={!props.canSchedule} onClick={props.onSchedule} title="Add to Schedule" aria-label="Add to Schedule"><CalendarPlus size={14} /></button>
                <button type="button" className="st-iconbtn st-iconbtn--sm" onClick={() => setMax(true)} title="Bigger view" aria-label="Bigger view"><Expand size={14} /></button>
              </span>
            </div>
          </div>
        )}
        {isAlternate && props.hasLook && (
          <div className="st-altlook" role="group" aria-label="Alternate output look">
            <span>Alternate look</span>
            <button type="button" className={props.alternateMode === "fullscreen" ? "is-on" : ""} aria-pressed={props.alternateMode === "fullscreen"} onClick={() => props.onAlternateMode("fullscreen")} title="Use full screen words on the alternate output">
              <Monitor size={14} /> Full Screen
            </button>
            <button type="button" className={props.alternateMode === "lower-third" ? "is-on" : ""} aria-pressed={props.alternateMode === "lower-third"} onClick={() => props.onAlternateMode("lower-third")} title="Use lower third words on the alternate output">
              <PanelBottom size={14} /> Lower Third
            </button>
          </div>
        )}
      </div>

      <div className="st-lo__actions st-lo__actions--simple">
        <div className="st-lo__send st-lo__send--color">
          <button type="button" className="st-lo__sendmain" onClick={props.onGoLive} disabled={!props.canGoLive} title={props.previewFirst ? "Show Preview on the screen (Space)" : "Send to the screen (Space)"}>
            <Monitor size={16} /> <span>Send</span> <kbd>Space</kbd>
          </button>
          <button type="button" className="st-lo__sendmenu" onClick={openSendMenu} aria-haspopup="menu" aria-label="Send options" title={props.previewFirst ? "Preview first is on. Change it here." : "Straight to screen is on. Change it here."}>
            <ChevronDown size={15} />
          </button>
        </div>
        <button type="button" className="st-lo__clear" onClick={props.onClear} disabled={!onAir} title="Take everything off the screen (it fades out)">
          <MonitorOff size={15} /> <span>Clear</span>
        </button>
      </div>

      {max && showFrame && (
        <StudioModal
          big
          title={isLiveFeed ? `${isAlternate ? "Alternate output" : "Main output"} · ${liveText}` : `Preview · ${slideName(previewSlide) || "nothing chosen yet"}`}
          onClose={() => setMax(false)}
        >
          <div className="st-bigview">
            <ScaledFrame title={`${frameTitle} (big)`} src={frameUrl} cam={isLiveFeed ? props.liveCam : props.previewCam} />
          </div>
        </StudioModal>
      )}

      {props.nextLabel && props.onNextItem && (
        <button type="button" className="st-nextitem" onClick={props.onNextItem} title="Show the next item in the schedule (N)">
          <span className="st-nextitem__label">Next in schedule</span>
          <span className="st-nextitem__name">{props.nextLabel}</span>
          <kbd>N</kbd>
          <ChevronRight size={15} />
        </button>
      )}

      {props.playback}

      <div className="st-lo__stack">
        {props.graphicLive && props.onCloseGraphic && (
          <section className="st-lo__mini st-lo__stackfull">
            <div className="st-lo__gfx" role="status">
              <span className="st-lo__gfxdot" aria-hidden="true" />
              <span className="st-lo__gfxname" title={props.graphicLive.name}><small>Graphic on the screen</small>{props.graphicLive.name}</span>
              <button type="button" className="st-lo__gfxclose" onClick={props.onCloseGraphic} title="Take the graphic off the screen (Alt+G)">
                <X size={14} /> Remove
              </button>
            </div>
          </section>
        )}
        <section className="st-lo__mini st-lo__words" aria-label="Display Mode">
          <div className="st-lo__minihead">
            <strong><Monitor size={15} /> Display Mode</strong>
          </div>
          {props.scenePicker}
        </section>
        <div className="st-lo__textpair">
        {hasLook && (
          <TextSettingsCard
            textScale={props.textScale}
            onTextScale={props.onTextScale}
            bold={props.textBold}
            italic={props.textItalic}
            onBold={props.onTextBold}
            onItalic={props.onTextItalic}
            look={props.textLook}
            onLook={props.onTextLook}
            transition={props.transition}
            onTransition={props.onTransition}
            disabled={wordsOff}
          />
        )}
          {props.themeCard}
        </div>
        {props.cameraCard}
      </div>

      {props.children}
      <StudioMenu menu={menu} onClose={() => setMenu(null)} />
    </section>
  );
}
