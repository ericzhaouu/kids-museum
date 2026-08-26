"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Monitor,
  Palette,
  Plus,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { MuseumExperience } from "@/components/museum-experience";
import type { StudioArtwork } from "@/lib/artworks/contracts";
import {
  buildExhibitionPreview,
  createEmptyExhibition,
  createEmptyExhibitionRoom,
  exhibitionStatuses,
  framePresets,
  normalizeEditableExhibition,
  normalizeRoomArtworkDisplayConfig,
  summarizeEditableExhibition,
  validateExhibitionForPublish,
  type EditableExhibition,
  type ExhibitionAiSuggestion,
} from "@/lib/exhibition-curation";
import {
  archiveExhibitionRequest,
  deleteExhibitionRequest,
  fetchExhibitions,
  fetchExhibitionSuggestions,
  generateExhibitionSuggestions,
  reviewExhibitionSuggestion,
  saveExhibitionRequest,
} from "@/lib/exhibitions/client";
import {
  exhibitionThemeOptions,
  type ExhibitionThemeId,
} from "@/lib/exhibition-themes";
import { z } from "zod";

const initialLocalExhibition = createEmptyExhibition("warm-gallery");

const exhibitionStatusLabel: Record<(typeof exhibitionStatuses)[number], string> = {
  published: "已发布",
  draft: "草稿中",
  archived: "已归档",
};

type StudioExhibitionsPanelProps = {
  artworks: StudioArtwork[];
  cloudEnabled: boolean;
  artworksLoadState: "loading" | "ready" | "error";
};

export function StudioExhibitionsPanel({
  artworks,
  cloudEnabled,
  artworksLoadState,
}: StudioExhibitionsPanelProps) {
  const [exhibitions, setExhibitions] = useState<EditableExhibition[]>([
    initialLocalExhibition,
  ]);
  const [activeExhibitionId, setActiveExhibitionId] = useState<string | null>(
    initialLocalExhibition.id ?? null,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    cloudEnabled ? "loading" : "ready",
  );
  const [statusMessage, setStatusMessage] = useState(
    cloudEnabled ? "正在读取展览布置…" : "当前展览只保存在本地预览里",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [suggestions, setSuggestions] = useState<ExhibitionAiSuggestion[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState("");
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [reviewingSuggestionId, setReviewingSuggestionId] = useState("");

  const activeExhibition = useMemo(
    () =>
      exhibitions.find((exhibition) => exhibition.id === activeExhibitionId) ??
      exhibitions[0] ??
      initialLocalExhibition,
    [activeExhibitionId, exhibitions],
  );

  const editableArtworks = useMemo(
    () => artworks.filter((artwork) => artwork.status !== "archived"),
    [artworks],
  );
  const summary = useMemo(
    () => summarizeEditableExhibition(activeExhibition),
    [activeExhibition],
  );
  const publishCheck = useMemo(
    () => validateExhibitionForPublish(activeExhibition, artworks),
    [activeExhibition, artworks],
  );
  const previewExhibition = useMemo(
    () => buildExhibitionPreview(activeExhibition, artworks),
    [activeExhibition, artworks],
  );

  useEffect(() => {
    if (!cloudEnabled) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchExhibitions();
        if (cancelled) {
          return;
        }
        if (result.exhibitions.length > 0) {
          setExhibitions(result.exhibitions);
          setActiveExhibitionId(result.activeExhibitionId);
          setStatusMessage("已读取云端展览布置");
        } else {
          const empty = createEmptyExhibition();
          setExhibitions([empty]);
          setActiveExhibitionId(empty.id ?? null);
          setStatusMessage("还没有云端展览，请创建第一场布展");
        }
        setLoadState("ready");
      } catch (error) {
        if (!cancelled) {
          setLoadState("error");
          setStatusMessage(error instanceof Error ? error.message : "展览读取失败。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cloudEnabled]);

  useEffect(() => {
    if (!cloudEnabled || !activeExhibition.id) {
      const frame = requestAnimationFrame(() => setSuggestions([]));
      return () => cancelAnimationFrame(frame);
    }

    let cancelled = false;
    void (async () => {
      setLoadingSuggestions(true);
      try {
        const payload = await fetchExhibitionSuggestions(activeExhibition.id!);
        if (!cancelled) {
          setSuggestions(payload.suggestions);
          setSuggestionStatus("");
        }
      } catch (error) {
        if (!cancelled) {
          setSuggestionStatus(
            error instanceof Error ? error.message : "策展建议读取失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingSuggestions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeExhibition.id, cloudEnabled]);

  const canSave = !cloudEnabled || (loadState === "ready" && artworksLoadState === "ready");

  const patchActiveExhibition = (
    updater: (current: EditableExhibition) => EditableExhibition,
  ) => {
    setExhibitions((current) =>
      current.map((exhibition) =>
        exhibition === activeExhibition ||
        (activeExhibition.id && exhibition.id === activeExhibition.id)
          ? updater(exhibition)
          : exhibition,
      ),
    );
    if (!cloudEnabled) {
      setStatusMessage("当前展览草稿仍在本地预览中，刷新后不会保留。");
    }
  };

  const createExhibition = () => {
    const existingUnsaved = exhibitions.find((exhibition) => !exhibition.id);
    if (existingUnsaved) {
      setActiveExhibitionId(existingUnsaved.id ?? null);
      setStatusMessage("请先保存当前新建展览，或继续编辑它。");
      return;
    }
    const next = createEmptyExhibition(activeExhibition.themeId);
    setExhibitions((current) => [next, ...current]);
    setActiveExhibitionId(next.id ?? null);
    setSuggestions([]);
    setStatusMessage("已创建新展览草稿。");
  };

  const saveExhibition = async (nextStatus: EditableExhibition["status"]) => {
    if (!canSave) {
      setStatusMessage("请等待作品库和展览布置读取完成后再保存。");
      return;
    }
    if (!activeExhibition.title.trim()) {
      setStatusMessage("请先填写展览标题。");
      return;
    }
    if (nextStatus === "published" && !publishCheck.valid) {
      setStatusMessage(publishCheck.issues[0]?.message ?? "当前展览还不能发布。");
      return;
    }

    const payload = normalizeEditableExhibition({
      ...activeExhibition,
      status: nextStatus,
    });

    setIsSaving(true);
    try {
      const previousId = activeExhibition.id;
      if (cloudEnabled) {
        const result = await saveExhibitionRequest(payload);
        setExhibitions((current) => {
          if (previousId) {
            return current.map((exhibition) =>
              exhibition.id === result.exhibition.id ? result.exhibition : exhibition,
            );
          }

          const unsavedIndex = current.findIndex((exhibition) => !exhibition.id);
          if (unsavedIndex < 0) {
            return [result.exhibition, ...current];
          }
          return current.map((exhibition, index) =>
            index === unsavedIndex ? result.exhibition : exhibition,
          );
        });
        setActiveExhibitionId(result.exhibition.id ?? null);
        setStatusMessage(
          nextStatus === "published"
            ? "展览已发布；首页会读取最新发布的一场。"
            : nextStatus === "archived"
              ? "展览已归档。"
              : "展览草稿已保存到私密云端。",
        );
      } else {
        patchActiveExhibition(() => payload);
        setStatusMessage(
          nextStatus === "published"
            ? "当前预览已标记为发布，但刷新后不会保留。"
            : "当前预览展览草稿已更新。",
        );
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "展览保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const archiveActiveExhibition = async () => {
    if (!activeExhibition.id) {
      patchActiveExhibition((current) => ({ ...current, status: "archived" }));
      setStatusMessage("本地草稿已归档。");
      return;
    }

    setIsSaving(true);
    try {
      const archived = await archiveExhibitionRequest(activeExhibition.id);
      setExhibitions((current) =>
        current.map((exhibition) => (exhibition.id === archived.id ? archived : exhibition)),
      );
      setStatusMessage("展览已归档。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "展览归档失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteActiveExhibition = async () => {
    if (exhibitions.length === 1) {
      setStatusMessage("至少保留一场展览，才能继续策展。");
      return;
    }
    if (!window.confirm(`确定删除“${activeExhibition.title}”吗？`)) {
      return;
    }

    if (!activeExhibition.id) {
      setExhibitions((current) => current.filter((item) => item !== activeExhibition));
      setActiveExhibitionId(exhibitions.find((item) => item !== activeExhibition)?.id ?? null);
      setStatusMessage("本地草稿已删除。");
      return;
    }

    setIsSaving(true);
    try {
      const result = await deleteExhibitionRequest(activeExhibition.id);
      setExhibitions((current) =>
        current.filter((exhibition) => exhibition.id !== activeExhibition.id),
      );
      setActiveExhibitionId(result.activeExhibitionId);
      setStatusMessage("展览已删除。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "展览删除失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleArtworkInRoom = (roomId: string, artworkId: string) => {
    patchActiveExhibition((current) => ({
      ...current,
      rooms: current.rooms.map((room) => {
        if (room.id !== roomId) {
          return room;
        }
        const exists = room.artworks.some((artwork) => artwork.artworkId === artworkId);
        return {
          ...room,
          artworks: exists
            ? room.artworks.filter((artwork) => artwork.artworkId !== artworkId)
            : [
                ...room.artworks,
                {
                  artworkId,
                  displayConfig: normalizeRoomArtworkDisplayConfig(),
                },
              ],
        };
      }),
    }));
  };

  const updateRoomArtworkDisplay = (
    roomId: string,
    artworkId: string,
    partial: Partial<ReturnType<typeof normalizeRoomArtworkDisplayConfig>>,
  ) => {
    patchActiveExhibition((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.id !== roomId
          ? room
          : {
              ...room,
              artworks: room.artworks.map((artwork) =>
                artwork.artworkId !== artworkId
                  ? artwork
                  : {
                      ...artwork,
                      displayConfig: normalizeRoomArtworkDisplayConfig({
                        ...artwork.displayConfig,
                        ...partial,
                      }),
                    },
              ),
            },
      ),
    }));
  };

  const pendingSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.status === "pending"),
    [suggestions],
  );

  return (
    <>
      <article
        id="exhibitions"
        className="studio-panel studio-panel--wide exhibition-editor"
        inert={canSave ? undefined : true}
        aria-busy={!canSave}
        style={canSave ? undefined : { opacity: 0.72 }}
      >
        <div className="panel-heading">
          <span className="panel-icon">
            <Archive size={20} aria-hidden="true" />
          </span>
          <div>
            <strong>展览策展编辑器</strong>
            <small
              className={
                activeExhibition.status === "published"
                  ? "panel-status panel-status--published"
                  : "panel-status panel-status--draft"
              }
            >
              {exhibitionStatusLabel[activeExhibition.status]}
            </small>
          </div>
        </div>

        <div className="exhibition-manager-grid">
          <aside className="exhibition-list-panel">
            <div className="exhibition-room-toolbar">
              <div>
                <strong>多展览</strong>
                <small>最新 published 会成为首页默认展厅。</small>
              </div>
              <button type="button" onClick={createExhibition}>
                <Plus size={16} aria-hidden="true" />
                新建
              </button>
            </div>
            <div className="exhibition-list">
              {exhibitions.map((exhibition) => {
                const itemSummary = summarizeEditableExhibition(exhibition);
                return (
                  <button
                    type="button"
                    key={exhibition.id ?? exhibition.title}
                    className={`exhibition-list-item${
                      exhibition.id === activeExhibition.id ? " is-active" : ""
                    }`}
                    onClick={() => setActiveExhibitionId(exhibition.id ?? null)}
                  >
                    <strong>{exhibition.title || "未命名展览"}</strong>
                    <small>
                      {exhibitionStatusLabel[exhibition.status]} · {itemSummary.roomCount} 个展室
                    </small>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="exhibition-editor-detail">
            <div className="exhibition-editor-header">
              <div>
                <h3>{activeExhibition.title || "未命名展览"}</h3>
                <p>
                  {summary.roomCount} 个展室 · {summary.artworkCount} 件作品 · 主题 v
                  {activeExhibition.themeVersion ?? 1} · 策展 v
                  {activeExhibition.curationVersion ?? 1}
                </p>
              </div>
              <div className="exhibition-editor-actions">
                <button type="button" onClick={() => setPreviewOpen(true)}>
                  预览草稿
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void saveExhibition("draft")}
                  disabled={isSaving || !canSave}
                >
                  保存草稿
                </button>
                <button
                  type="button"
                  onClick={() => void archiveActiveExhibition()}
                  disabled={isSaving || !canSave}
                >
                  归档
                </button>
                <button
                  type="button"
                  onClick={() => void deleteActiveExhibition()}
                  disabled={isSaving || !canSave}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void saveExhibition("published")}
                  disabled={isSaving || !canSave}
                >
                  {isSaving ? "正在保存…" : "发布当前展览"}
                </button>
              </div>
            </div>

            <div className="exhibition-editor-fields">
              <label>
                <span>展览标题</span>
                <input
                  value={activeExhibition.title}
                  onChange={(event) =>
                    patchActiveExhibition((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  maxLength={100}
                  placeholder="例如：想象力有翅膀"
                />
              </label>
              <label>
                <span>展览副标题</span>
                <input
                  value={activeExhibition.subtitle}
                  onChange={(event) =>
                    patchActiveExhibition((current) => ({
                      ...current,
                      subtitle: event.target.value,
                    }))
                  }
                  maxLength={150}
                  placeholder="一句给家人看的副标题"
                />
              </label>
              <label className="is-full">
                <span>门厅介绍</span>
                <textarea
                  value={activeExhibition.introduction}
                  onChange={(event) =>
                    patchActiveExhibition((current) => ({
                      ...current,
                      introduction: event.target.value,
                    }))
                  }
                  rows={3}
                  maxLength={2000}
                  placeholder="说明这一场展览想留住什么样的创作瞬间"
                />
              </label>
            </div>

            <div className="theme-picker exhibition-theme-picker">
              <span>
                <Palette size={17} aria-hidden="true" />
                展厅主题
              </span>
              <div role="group" aria-label="选择展厅风格">
                {exhibitionThemeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={activeExhibition.themeId === option.value ? "is-active" : ""}
                    onClick={() =>
                      patchActiveExhibition((current) => ({
                        ...current,
                        themeId: option.value as ExhibitionThemeId,
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <small>发布后首页默认采用该主题；观众仍可在展厅中临时切换。</small>
            </div>

            <div className="ai-suggestion-panel exhibition-ai-panel">
              <div className="ai-suggestion-heading">
                <span className="callout-icon">
                  <Sparkles size={20} aria-hidden="true" />
                </span>
                <div>
                  <strong>AI 策展文案建议</strong>
                  <p>仅使用作品标题、介绍和孩子原话生成待审核建议，不会自动发布。</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={generatingSuggestions || !activeExhibition.id}
                  onClick={() =>
                    void (async () => {
                      if (!activeExhibition.id) {
                        setSuggestionStatus("请先保存草稿，再生成可审核的策展建议。");
                        return;
                      }
                      setGeneratingSuggestions(true);
                      try {
                        const payload = await generateExhibitionSuggestions(
                          activeExhibition.id,
                        );
                        setSuggestions(payload.suggestions);
                        setSuggestionStatus("策展建议已保存为待审核记录。");
                      } catch (error) {
                        setSuggestionStatus(
                          error instanceof Error
                            ? error.message
                            : "策展建议生成失败。",
                        );
                      } finally {
                        setGeneratingSuggestions(false);
                      }
                    })()
                  }
                >
                  <WandSparkles size={16} aria-hidden="true" />
                  {generatingSuggestions ? "正在生成…" : "生成策展建议"}
                </button>
              </div>
              {suggestionStatus ? <p className="exhibition-status">{suggestionStatus}</p> : null}
              {loadingSuggestions ? (
                <p className="empty-state-note">正在读取策展建议…</p>
              ) : null}
              {pendingSuggestions.length === 0 && !loadingSuggestions ? (
                <p className="empty-state-note">暂无待审核的策展建议。</p>
              ) : null}
              <div className="exhibition-suggestion-list">
                {suggestions.map((suggestion) => (
                  <article className="exhibition-suggestion-card" key={suggestion.id}>
                    <div>
                      <strong>
                        {suggestion.suggestionType === "title"
                          ? "展览标题"
                          : suggestion.suggestionType === "introduction"
                            ? "门厅序言"
                            : `展室 ${String((suggestion.targetRoomOrder ?? 0) + 1).padStart(2, "0")} 串词`}
                      </strong>
                      <small>
                        {suggestion.status} · v{suggestion.inputVersion}
                      </small>
                    </div>
                    <p>{readSuggestionText(suggestion.content)}</p>
                    {suggestion.status === "pending" ? (
                      <div className="exhibition-editor-actions">
                        <button
                          type="button"
                          disabled={reviewingSuggestionId === suggestion.id}
                          onClick={() =>
                            void reviewSuggestion(
                              suggestion.id,
                              "accept",
                              setReviewingSuggestionId,
                              setSuggestions,
                              setExhibitions,
                              setActiveExhibitionId,
                              setSuggestionStatus,
                            )
                          }
                        >
                          采纳
                        </button>
                        <button
                          type="button"
                          disabled={reviewingSuggestionId === suggestion.id}
                          onClick={() =>
                            void reviewSuggestion(
                              suggestion.id,
                              "reject",
                              setReviewingSuggestionId,
                              setSuggestions,
                              setExhibitions,
                              setActiveExhibitionId,
                              setSuggestionStatus,
                            )
                          }
                        >
                          拒绝
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <div className="exhibition-room-toolbar">
              <div>
                <strong>展室布置</strong>
                <small>草稿可先用未归档作品，发布时会严格校验。</small>
              </div>
              <button
                type="button"
                onClick={() =>
                  patchActiveExhibition((current) => ({
                    ...current,
                    rooms: [...current.rooms, createEmptyExhibitionRoom(current.rooms.length)],
                  }))
                }
              >
                <Plus size={16} aria-hidden="true" />
                新增展室
              </button>
            </div>

            <div className="exhibition-room-list">
              {activeExhibition.rooms.map((room, roomIndex) => (
                <section
                  className="exhibition-room-card"
                  key={room.id ?? `room-${roomIndex}`}
                >
                  <div className="exhibition-room-header">
                    <div>
                      <span>展室 {String(roomIndex + 1).padStart(2, "0")}</span>
                      <strong>{room.name || "未命名展室"}</strong>
                    </div>
                    <div className="exhibition-room-actions">
                      <button
                        type="button"
                        disabled={roomIndex === 0}
                        onClick={() =>
                          patchActiveExhibition((current) => ({
                            ...current,
                            rooms: reorder(current.rooms, roomIndex, roomIndex - 1),
                          }))
                        }
                      >
                        <ArrowUp size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={roomIndex === activeExhibition.rooms.length - 1}
                        onClick={() =>
                          patchActiveExhibition((current) => ({
                            ...current,
                            rooms: reorder(current.rooms, roomIndex, roomIndex + 1),
                          }))
                        }
                      >
                        <ArrowDown size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchActiveExhibition((current) => ({
                            ...current,
                            rooms:
                              current.rooms.length > 1
                                ? current.rooms.filter((item) => item.id !== room.id)
                                : current.rooms,
                          }))
                        }
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="exhibition-room-fields">
                    <label>
                      <span>展室名称</span>
                      <input
                        value={room.name}
                        onChange={(event) =>
                          patchActiveExhibition((current) => ({
                            ...current,
                            rooms: current.rooms.map((item) =>
                              item.id === room.id ? { ...item, name: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>展室副标题</span>
                      <input
                        value={room.subtitle}
                        onChange={(event) =>
                          patchActiveExhibition((current) => ({
                            ...current,
                            rooms: current.rooms.map((item) =>
                              item.id === room.id
                                ? { ...item, subtitle: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label className="is-full">
                      <span>墙面说明 / 串词</span>
                      <textarea
                        value={room.introduction}
                        rows={2}
                        onChange={(event) =>
                          patchActiveExhibition((current) => ({
                            ...current,
                            rooms: current.rooms.map((item) =>
                              item.id === room.id
                                ? { ...item, introduction: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="room-assignment-grid">
                    <div className="room-assignment-panel">
                      <div className="room-assignment-heading">
                        <strong>选择作品</strong>
                        <small>草稿可排入未归档作品；发布只接受已发布作品。</small>
                      </div>
                      <div className="room-artwork-options">
                        {editableArtworks.map((artwork) => {
                          const selected = room.artworks.some(
                            (item) => item.artworkId === artwork.id,
                          );
                          return (
                            <button
                              type="button"
                              key={artwork.id}
                              className={selected ? "is-selected" : ""}
                              onClick={() =>
                                toggleArtworkInRoom(room.id ?? `room-${roomIndex}`, artwork.id)
                              }
                            >
                              <strong>{artwork.title}</strong>
                              <small>
                                {artwork.status === "published" ? "可发布" : "仅草稿可用"} ·{" "}
                                {artwork.age}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="room-assignment-panel">
                      <div className="room-assignment-heading">
                        <strong>展出顺序与展示配置</strong>
                        <small>{room.artworks.length} 件作品已入选</small>
                      </div>
                      {room.artworks.length === 0 ? (
                        <p className="empty-state-note">这间展室还没有作品。</p>
                      ) : (
                        <ul className="room-selected-artworks">
                          {room.artworks.map((placement, artworkIndex) => {
                            const artwork = artworks.find(
                              (item) => item.id === placement.artworkId,
                            );
                            if (!artwork) {
                              return null;
                            }
                            return (
                              <li key={artwork.id} className="room-selected-artwork-card">
                                <div>
                                  <span>{String(artworkIndex + 1).padStart(2, "0")}</span>
                                  <strong>{artwork.title}</strong>
                                  <small>
                                    {artwork.status === "published"
                                      ? "发布后可见"
                                      : "仅保存在草稿内"}
                                  </small>
                                </div>
                                <div className="room-selected-actions">
                                  <button
                                    type="button"
                                    disabled={artworkIndex === 0}
                                    onClick={() =>
                                      patchActiveExhibition((current) => ({
                                        ...current,
                                        rooms: current.rooms.map((item) =>
                                          item.id !== room.id
                                            ? item
                                            : {
                                                ...item,
                                                artworks: reorder(
                                                  item.artworks,
                                                  artworkIndex,
                                                  artworkIndex - 1,
                                                ),
                                              },
                                        ),
                                      }))
                                    }
                                  >
                                    <ArrowUp size={15} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={artworkIndex === room.artworks.length - 1}
                                    onClick={() =>
                                      patchActiveExhibition((current) => ({
                                        ...current,
                                        rooms: current.rooms.map((item) =>
                                          item.id !== room.id
                                            ? item
                                            : {
                                                ...item,
                                                artworks: reorder(
                                                  item.artworks,
                                                  artworkIndex,
                                                  artworkIndex + 1,
                                                ),
                                              },
                                        ),
                                      }))
                                    }
                                  >
                                    <ArrowDown size={15} aria-hidden="true" />
                                  </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleArtworkInRoom(
                                          room.id ?? `room-${roomIndex}`,
                                          artwork.id,
                                        )
                                      }
                                    >
                                      <Trash2 size={15} aria-hidden="true" />
                                    </button>
                                </div>
                                <div className="room-display-config">
                                  <label>
                                    <span>尺寸</span>
                                    <select
                                      value={placement.displayConfig?.size ?? "medium"}
                                      onChange={(event) =>
                                        updateRoomArtworkDisplay(
                                          room.id ?? `room-${roomIndex}`,
                                          artwork.id,
                                          {
                                            size: event.target.value as
                                              NonNullable<
                                                typeof placement.displayConfig
                                              >["size"],
                                          },
                                        )
                                      }
                                    >
                                      <option value="small">small</option>
                                      <option value="medium">medium</option>
                                      <option value="large">large</option>
                                    </select>
                                  </label>
                                  <label>
                                    <span>画框</span>
                                    <select
                                      value={placement.displayConfig?.framePreset ?? "classic"}
                                      onChange={(event) =>
                                        updateRoomArtworkDisplay(
                                          room.id ?? `room-${roomIndex}`,
                                          artwork.id,
                                          {
                                            framePreset: event.target.value as
                                              NonNullable<
                                                typeof placement.displayConfig
                                              >["framePreset"],
                                          },
                                        )
                                      }
                                    >
                                      {framePresets.map((preset) => (
                                        <option value={preset} key={preset}>
                                          {preset}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    className={`display-feature-toggle${
                                      placement.displayConfig?.featured ? " is-active" : ""
                                    }`}
                                    onClick={() =>
                                      updateRoomArtworkDisplay(
                                        room.id ?? `room-${roomIndex}`,
                                        artwork.id,
                                        {
                                          featured: !placement.displayConfig?.featured,
                                        },
                                      )
                                    }
                                  >
                                    <Star size={14} aria-hidden="true" />
                                    {placement.displayConfig?.featured ? "重点作品" : "设为重点"}
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>

            {!publishCheck.valid ? (
              <div className="exhibition-status">
                {publishCheck.issues.map((issue) => (
                  <div key={issue.path}>{issue.message}</div>
                ))}
              </div>
            ) : null}
            <p className="exhibition-status" role="status">
              {statusMessage}
            </p>
          </div>
        </div>
      </article>

      {previewOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewOpen(false);
            }
          }}
        >
          <section className="exhibition-preview-dialog" role="dialog" aria-modal="true">
            <header className="exhibition-preview-header">
              <div>
                <p className="eyebrow">CURATION PREVIEW</p>
                <h2>{activeExhibition.title || "草稿预览"}</h2>
              </div>
              <div className="exhibition-editor-actions">
                <button
                  type="button"
                  className={previewDevice === "desktop" ? "is-active" : ""}
                  onClick={() => setPreviewDevice("desktop")}
                >
                  <Monitor size={16} aria-hidden="true" />
                  桌面
                </button>
                <button
                  type="button"
                  className={previewDevice === "mobile" ? "is-active" : ""}
                  onClick={() => setPreviewDevice("mobile")}
                >
                  <Smartphone size={16} aria-hidden="true" />
                  手机
                </button>
                <button type="button" className="icon-button" onClick={() => setPreviewOpen(false)}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div
              className={`exhibition-preview-frame exhibition-preview-frame--${previewDevice}`}
            >
              <MuseumExperience exhibition={previewExhibition} embedded />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

async function reviewSuggestion(
  suggestionId: string,
  action: "accept" | "reject",
  setReviewingSuggestionId: (value: string) => void,
  setSuggestions: (value: ExhibitionAiSuggestion[]) => void,
  setExhibitions: Dispatch<SetStateAction<EditableExhibition[]>>,
  setActiveExhibitionId: (value: string | null) => void,
  setSuggestionStatus: (value: string) => void,
) {
  setReviewingSuggestionId(suggestionId);
  try {
    const result = await reviewExhibitionSuggestion(suggestionId, action);
    setSuggestions(result.suggestions);
    setExhibitions((current) =>
      current.map((exhibition) =>
        exhibition.id === result.exhibition.id ? result.exhibition : exhibition,
      ),
    );
    setActiveExhibitionId(result.exhibition.id ?? null);
    setSuggestionStatus(action === "accept" ? "策展建议已采纳。" : "策展建议已拒绝。");
  } catch (error) {
    setSuggestionStatus(
      error instanceof Error ? error.message : "策展建议审核失败。",
    );
  } finally {
    setReviewingSuggestionId("");
  }
}

function reorder<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [selected] = next.splice(from, 1);
  next.splice(to, 0, selected);
  return next;
}

function readSuggestionText(content: unknown) {
  const parsed = z
    .object({
      value: z.string(),
    })
    .safeParse(content);
  return parsed.success ? parsed.data.value : "建议内容不可读";
}
