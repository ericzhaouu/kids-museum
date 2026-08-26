"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Download,
  Grid2X2,
  LockKeyhole,
  Menu,
  Palette,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { ArtworkVisual } from "@/components/artwork-visual";
import type { Artwork, Exhibition } from "@/lib/museum-data";
import {
  downloadArtworkPoster,
  POSTER_TEMPLATE_OPTIONS,
  type PosterTemplate,
} from "@/lib/share-poster";

type MuseumExperienceProps = {
  exhibition: Exhibition;
  embedded?: boolean;
};

export function MuseumExperience({
  exhibition,
  embedded = false,
}: MuseumExperienceProps) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const lastWheelNavigationAt = useRef(0);
  const [panelIndex, setPanelIndex] = useState(0);
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [posterTemplate, setPosterTemplate] =
    useState<PosterTemplate>("xiaohongshu-poster");
  const [galleryStyle, setGalleryStyle] = useState("warm-gallery");
  const [simpleMode, setSimpleMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const savedSimpleMode = window.localStorage.getItem("museum-simple-mode");
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    return savedSimpleMode === "1" || (!savedSimpleMode && prefersReducedMotion);
  });
  const panelCount = exhibition.rooms.length + 1;

  const moveToPanel = useCallback(
    (nextIndex: number) => {
      const targetIndex = Math.min(Math.max(nextIndex, 0), panelCount - 1);
      const gallery = galleryRef.current;
      if (!gallery) {
        return;
      }

      gallery.scrollTo({
        left: targetIndex * gallery.clientWidth,
        behavior: "smooth",
      });
      setPanelIndex(targetIndex);
    },
    [panelCount],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedArtwork(null);
        setCatalogOpen(false);
        return;
      }

      if (selectedArtwork || catalogOpen || simpleMode) {
        return;
      }

      if (event.key === "ArrowRight") {
        moveToPanel(panelIndex + 1);
      }
      if (event.key === "ArrowLeft") {
        moveToPanel(panelIndex - 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [catalogOpen, moveToPanel, panelIndex, selectedArtwork, simpleMode]);

  useEffect(() => {
    if (embedded) {
      return;
    }
    document.body.style.overflow = selectedArtwork || catalogOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [catalogOpen, embedded, selectedArtwork]);

  useEffect(() => {
    const savedStyle = window.localStorage.getItem("museum-gallery-style");
    const style =
      savedStyle === "white-box" || savedStyle === "storybook"
        ? savedStyle
        : exhibition.themeId ?? "warm-gallery";
    const frame = window.requestAnimationFrame(() => setGalleryStyle(style));
    return () => window.cancelAnimationFrame(frame);
  }, [exhibition.themeId]);

  useEffect(() => {
    document.documentElement.dataset.galleryStyle = galleryStyle;
    return () => {
      delete document.documentElement.dataset.galleryStyle;
    };
  }, [galleryStyle]);

  const updateGalleryStyle = (style: string) => {
    setGalleryStyle(style);
    window.localStorage.setItem("museum-gallery-style", style);
  };

  const toggleSimpleMode = () => {
    setSimpleMode((current) => {
      const next = !current;
      window.localStorage.setItem("museum-simple-mode", next ? "1" : "0");
      if (next) {
        setPanelIndex(0);
      }
      return next;
    });
  };

  const handleGalleryScroll = () => {
    const gallery = galleryRef.current;
    if (!gallery || gallery.clientWidth === 0) {
      return;
    }
    setPanelIndex(Math.round(gallery.scrollLeft / gallery.clientWidth));
  };

  const handleGalleryWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (
      simpleMode ||
      selectedArtwork ||
      catalogOpen ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    ) {
      return;
    }

    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
    const normalizedDelta = event.deltaY * multiplier;
    if (Math.abs(normalizedDelta) < 20) {
      return;
    }
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelNavigationAt.current < 450) {
      return;
    }
    lastWheelNavigationAt.current = now;
    moveToPanel(panelIndex + (normalizedDelta > 0 ? 1 : -1));
  };

  const handlePosterDownload = async () => {
    if (!selectedArtwork || shareLoading) {
      return;
    }

    setShareError("");
    setShareLoading(true);
    try {
      await downloadArtworkPoster(selectedArtwork, posterTemplate);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "海报生成失败，请重试。");
    } finally {
      setShareLoading(false);
    }
  };

  const roomCountLabel = useMemo(
    () => `${exhibition.rooms.length} 个展室 · ${exhibition.rooms.reduce((count, room) => count + room.artworks.length, 0)} 件作品`,
    [exhibition.rooms],
  );

  return (
    <main className={`museum-shell${embedded ? " museum-shell--embedded" : ""}`}>
      <header className={`museum-header${embedded ? " museum-header--embedded" : ""}`}>
        <button
          type="button"
          className="brand-lockup"
          onClick={() => moveToPanel(0)}
          aria-label="返回博物馆门厅"
        >
          <span className="brand-seal">兮</span>
          <span>
            <strong>兮爷的小小博物馆</strong>
            <small>XI&apos;S LITTLE MUSEUM</small>
          </span>
        </button>

        <div className="header-actions">
          <span className="privacy-badge">
            <LockKeyhole size={14} aria-hidden="true" />
            家庭私享
          </span>
          <button
            type="button"
            className={`text-button simple-mode-toggle${simpleMode ? " is-active" : ""}`}
            onClick={toggleSimpleMode}
            aria-pressed={simpleMode}
          >
            <ScanSearch size={16} aria-hidden="true" />
            简洁模式
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setCatalogOpen(true)}
            aria-label="打开作品目录"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          {!embedded ? (
            <Link className="text-button header-studio-link" href="/studio">
              馆长台
            </Link>
          ) : null}
        </div>
      </header>

      {simpleMode ? (
        <SimpleModeExperience
          exhibition={exhibition}
          roomCountLabel={roomCountLabel}
          onOpenArtwork={(artwork) => {
            setShareError("");
            setSelectedArtwork(artwork);
          }}
          onOpenRoom={(roomIndex) => {
            setCatalogOpen(false);
            setSimpleMode(false);
            window.localStorage.setItem("museum-simple-mode", "0");
            requestAnimationFrame(() => moveToPanel(roomIndex + 1));
          }}
        />
      ) : (
        <>
          <div
            className="gallery-viewport"
            ref={galleryRef}
            onScroll={handleGalleryScroll}
            onWheel={handleGalleryWheel}
            aria-label="展览空间"
          >
            <section className="gallery-panel foyer-panel">
              <div className="foyer-ornament" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="foyer-copy">
                <p className="eyebrow">{exhibition.curatorNote}</p>
                <h1>{exhibition.title}</h1>
                <p className="foyer-subtitle">{exhibition.subtitle}</p>
                <p className="foyer-introduction">{exhibition.introduction}</p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => moveToPanel(1)}
                >
                  开始参观
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="foyer-ticket" aria-hidden="true">
                <span>NO. 001</span>
                <strong>想象力</strong>
                <small>ADMIT ONE FAMILY</small>
              </div>
              <p className="foyer-hint">左右滑动、滚轮横移，或使用方向键参观</p>
            </section>

            {exhibition.rooms.map((room) => (
              <section className="gallery-panel room-panel" key={room.id}>
                <div className="room-heading">
                  <span className="room-number">{room.number}</span>
                  <div>
                    <p className="eyebrow">展室 {room.number}</p>
                    <h2>{room.name}</h2>
                    <p>{room.subtitle}</p>
                  </div>
                </div>

                <div className="room-wall">
                  <div className="room-light room-light--left" aria-hidden="true" />
                  <div className="room-light room-light--right" aria-hidden="true" />
                  <div className="artwork-wall-grid">
                    {room.artworks.map((artwork) => (
                      <button
                        type="button"
                        className="artwork-frame"
                        data-size={artwork.display?.size ?? "medium"}
                        data-featured={artwork.display?.featured ? "true" : "false"}
                        data-frame-preset={artwork.display?.framePreset ?? "classic"}
                        onClick={() => {
                          setShareError("");
                          setSelectedArtwork(artwork);
                        }}
                        key={artwork.id}
                        aria-label={`近看作品：${artwork.title}`}
                      >
                        <span className="frame-mat">
                          <ArtworkDisplay artwork={artwork} />
                        </span>
                        <span className="artwork-label">
                          <strong>{artwork.title}</strong>
                          <small>
                            {artwork.age} · {artwork.medium}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="room-wall-note">{room.introduction}</p>
                </div>

                <div className="room-floor" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </section>
            ))}
          </div>

          <nav className="museum-navigation" aria-label="展室导航">
            <button
              type="button"
              className="nav-arrow"
              onClick={() => moveToPanel(panelIndex - 1)}
              disabled={panelIndex === 0}
              aria-label="上一个空间"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <div className="nav-progress">
              {Array.from({ length: panelCount }, (_, index) => (
                <button
                  type="button"
                  key={index}
                  className={index === panelIndex ? "is-active" : ""}
                  onClick={() => moveToPanel(index)}
                  aria-label={index === 0 ? "前往门厅" : `前往展室 ${index}`}
                  aria-current={index === panelIndex ? "step" : undefined}
                />
              ))}
            </div>
            <span className="nav-count">
              {String(panelIndex + 1).padStart(2, "0")} / {String(panelCount).padStart(2, "0")}
            </span>
            <button
              type="button"
              className="nav-arrow"
              onClick={() => moveToPanel(panelIndex + 1)}
              disabled={panelIndex === panelCount - 1}
              aria-label="下一个空间"
            >
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </nav>
        </>
      )}

      {selectedArtwork ? (
        <ArtworkDialog
          artwork={selectedArtwork}
          posterTemplate={posterTemplate}
          shareError={shareError}
          shareLoading={shareLoading}
          onClose={() => setSelectedArtwork(null)}
          onPosterTemplateChange={(value) => {
            setShareError("");
            setPosterTemplate(value);
          }}
          onPosterDownload={() => void handlePosterDownload()}
        />
      ) : null}

      {catalogOpen ? (
        <div
          className="catalog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCatalogOpen(false);
            }
          }}
        >
          <aside
            className="catalog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-title"
          >
            <div className="catalog-header">
              <div>
                <p className="eyebrow">EXHIBITION INDEX</p>
                <h2 id="catalog-title">本展目录</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCatalogOpen(false)}
                aria-label="关闭作品目录"
                autoFocus
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="catalog-rooms">
              {exhibition.rooms.map((room, roomIndex) => (
                <section key={room.id}>
                  <button
                    type="button"
                    className="catalog-room-button"
                    onClick={() => {
                      setCatalogOpen(false);
                      if (simpleMode) {
                        setSimpleMode(false);
                        window.localStorage.setItem("museum-simple-mode", "0");
                        window.requestAnimationFrame(() =>
                          window.requestAnimationFrame(() =>
                            moveToPanel(roomIndex + 1),
                          ),
                        );
                        return;
                      }
                      moveToPanel(roomIndex + 1);
                    }}
                  >
                    <span>{room.number}</span>
                    <strong>{room.name}</strong>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <div className="catalog-artworks">
                    {room.artworks.map((artwork) => (
                      <button
                        type="button"
                        key={artwork.id}
                        onClick={() => {
                          setCatalogOpen(false);
                          setShareError("");
                          setSelectedArtwork(artwork);
                        }}
                      >
                        <span className="catalog-thumbnail">
                          <ArtworkDisplay artwork={artwork} />
                        </span>
                        <span>
                          <strong>{artwork.title}</strong>
                          <small>{artwork.age}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="catalog-footer">
              <Grid2X2 size={18} aria-hidden="true" />
              可切换到简洁模式，使用目录 / 静态网格参观
            </div>
            <div className="theme-picker">
              <span>
                <Palette size={17} aria-hidden="true" />
                展厅风格
              </span>
              <div role="group" aria-label="选择展厅风格">
                {[
                  ["warm-gallery", "温暖画廊"],
                  ["white-box", "白盒展室"],
                  ["storybook", "童画手帐"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={galleryStyle === value ? "is-active" : ""}
                    onClick={() => updateGalleryStyle(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="catalog-mode-toggle">
                <button
                  type="button"
                  className={`secondary-button${simpleMode ? " is-active" : ""}`}
                  onClick={toggleSimpleMode}
                >
                  <ScanSearch size={16} aria-hidden="true" />
                  {simpleMode ? "退出简洁模式" : "进入简洁模式"}
                </button>
              </div>
              <small>只改变视觉主题或参观方式，不会修改任何作品或策展内容。</small>
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function SimpleModeExperience({
  exhibition,
  roomCountLabel,
  onOpenArtwork,
  onOpenRoom,
}: {
  exhibition: Exhibition;
  roomCountLabel: string;
  onOpenArtwork: (artwork: Artwork) => void;
  onOpenRoom: (roomIndex: number) => void;
}) {
  return (
    <div className="simple-mode-shell">
      <section className="simple-foyer">
        <p className="eyebrow">{exhibition.curatorNote}</p>
        <h1>{exhibition.title}</h1>
        <p className="foyer-subtitle">{exhibition.subtitle}</p>
        <p className="foyer-introduction">{exhibition.introduction}</p>
        <div className="simple-mode-meta">
          <span>{roomCountLabel}</span>
          <span>目录与静态网格，更适合低性能设备与无障碍浏览</span>
        </div>
      </section>

      <div className="simple-room-list">
        {exhibition.rooms.map((room, roomIndex) => (
          <section className="simple-room-card" key={room.id}>
            <div className="simple-room-heading">
              <div>
                <span>展室 {room.number}</span>
                <h2>{room.name}</h2>
                <p>{room.subtitle}</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => onOpenRoom(roomIndex)}>
                回到漫游视图
              </button>
            </div>
            <p className="room-wall-note simple-room-note">{room.introduction}</p>
            <div className="simple-artwork-grid">
              {room.artworks.map((artwork) => (
                <button
                  type="button"
                  key={artwork.id}
                  className="simple-artwork-card"
                  onClick={() => onOpenArtwork(artwork)}
                >
                  <span className="simple-artwork-media">
                    <ArtworkDisplay artwork={artwork} />
                  </span>
                  <span className="simple-artwork-copy">
                    <strong>{artwork.title}</strong>
                    <small>
                      {artwork.age} · {artwork.medium}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ArtworkDialog({
  artwork,
  posterTemplate,
  shareError,
  shareLoading,
  onClose,
  onPosterTemplateChange,
  onPosterDownload,
}: {
  artwork: Artwork;
  posterTemplate: PosterTemplate;
  shareError: string;
  shareLoading: boolean;
  onClose: () => void;
  onPosterTemplateChange: (value: PosterTemplate) => void;
  onPosterDownload: () => void;
}) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="artwork-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="artwork-dialog-title"
      >
        <button
          type="button"
          className="dialog-close icon-button"
          onClick={onClose}
          aria-label="关闭作品详情"
          autoFocus
        >
          <X size={20} aria-hidden="true" />
        </button>
        <div className="dialog-artwork">
          <ArtworkDisplay artwork={artwork} />
        </div>
        <div className="dialog-copy">
          <p className="eyebrow">
            {artwork.createdAt} · {artwork.age}
          </p>
          <h2 id="artwork-dialog-title">{artwork.title}</h2>
          <p className="artwork-medium">{artwork.medium}</p>
          <blockquote>
            <Sparkles size={18} aria-hidden="true" />
            <span>“{artwork.childQuote}”</span>
            <cite>— 兮爷原话</cite>
          </blockquote>
          <div className="curator-description">
            <span>作品小记</span>
            <p>{artwork.description}</p>
          </div>
          {artwork.audioUrl ? (
            <div className="artwork-audio-panel">
              <BookOpen size={18} aria-hidden="true" />
              <div>
                <span>真实录音</span>
                <audio controls preload="none" src={artwork.audioUrl} />
              </div>
            </div>
          ) : (
            <div className="audio-placeholder">
              <BookOpen size={18} aria-hidden="true" />
              <span>这件作品的原声故事还在等待补录</span>
            </div>
          )}
          <div className="poster-share-panel">
            <p className="poster-privacy-notice" id="poster-privacy-notice">
              <LockKeyhole size={16} aria-hidden="true" />
              仅使用作品标题、年龄标签、媒材、作品小记与孩子原话；不含姓名、生日、家长备注、链接、二维码或访问凭证。
            </p>
            <fieldset
              className="poster-template-picker"
              aria-describedby="poster-privacy-notice"
            >
              <legend>选择分享版式</legend>
              <div className="poster-template-options">
                {POSTER_TEMPLATE_OPTIONS.map((option) => (
                  <label
                    className={`poster-template-option${
                      posterTemplate === option.value ? " is-active" : ""
                    }`}
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name="poster-template"
                      value={option.value}
                      checked={posterTemplate === option.value}
                      onChange={() => onPosterTemplateChange(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              className="poster-download-button"
              onClick={onPosterDownload}
              disabled={shareLoading}
            >
              <Download size={17} aria-hidden="true" />
              {shareLoading ? "正在生成海报…" : "下载所选隐私安全海报"}
            </button>
            {shareError ? (
              <p className="poster-error" role="alert">
                {shareError}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ArtworkDisplay({ artwork }: { artwork: Artwork }) {
  if (artwork.imageUrl) {
    return (
      <span className="artwork-image" aria-hidden="true">
        <Image
          src={artwork.imageUrl}
          alt={artwork.title}
          fill
          sizes="(max-width: 680px) 70vw, 33vw"
          unoptimized
        />
      </span>
    );
  }

  if (artwork.visual) {
    return <ArtworkVisual visual={artwork.visual} title={artwork.title} />;
  }

  return <span className="artwork-image artwork-image--empty" aria-hidden="true" />;
}
