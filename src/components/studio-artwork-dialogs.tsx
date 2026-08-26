"use client";

import {
  Check,
  CircleHelp,
  Clock3,
  FileAudio,
  ImagePlus,
  LockKeyhole,
  Mic,
  RotateCw,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type {
  ArtworkMetadataInput,
  CreateArtworkPayload,
  PatchArtworkPayload,
  StudioArtwork,
  StudioSuggestion,
} from "@/lib/artworks/contracts";
import {
  fetchArtworkSuggestions,
  generateArtworkSuggestions,
  requestArtworkTranscription,
  reviewArtworkSuggestion,
} from "@/lib/artworks/client";
import { buildArtworkAudioInput } from "@/lib/audio-processing";
import {
  buildArtworkImageBundle,
  defaultImageEditorState,
  type ImageEditorState,
  type SanitizedImageBundle,
} from "@/lib/image-processing";

type EditArtworkDialogProps = {
  artwork: StudioArtwork;
  cloudEnabled: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSave: (updates: PatchArtworkPayload) => Promise<void>;
};

type NewArtworkDialogProps = {
  onClose: () => void;
  onCreate: (artwork: CreateArtworkPayload) => Promise<void>;
};

type DraftArtworkItem = ArtworkMetadataInput & {
  id: string;
  fileName: string;
  image: SanitizedImageBundle;
  audio: CreateArtworkPayload["audio"] | null;
  saveState: "idle" | "saving" | "saved" | "error";
  saveError: string;
};

type MediaDraftState = {
  image: SanitizedImageBundle | null;
  audio: CreateArtworkPayload["audio"] | null;
  imageError: string;
  audioError: string;
  isProcessingImage: boolean;
  isProcessingAudio: boolean;
  editor: ImageEditorState;
};

export function EditArtworkDialog({
  artwork,
  cloudEnabled,
  onClose,
  onRefresh,
  onSave,
}: EditArtworkDialogProps) {
  const [title, setTitle] = useState(artwork.title);
  const [description, setDescription] = useState(artwork.description);
  const [createdOn, setCreatedOn] = useState(artwork.createdOn ?? "");
  const [age, setAge] = useState(artwork.age);
  const [medium, setMedium] = useState(artwork.medium);
  const [childQuote, setChildQuote] = useState(artwork.childQuote ?? "");
  const [parentNote, setParentNote] = useState(artwork.parentNote ?? "");
  const [media, setMedia] = useState<MediaDraftState>({
    image: null,
    audio: null,
    imageError: "",
    audioError: "",
    isProcessingImage: false,
    isProcessingAudio: false,
    editor: defaultImageEditorState,
  });
  const [removeAudio, setRemoveAudio] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [suggestions, setSuggestions] = useState<StudioSuggestion[]>([]);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(cloudEnabled);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [reviewingSuggestionId, setReviewingSuggestionId] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState("");

  useEffect(() => {
    if (!cloudEnabled) {
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsLoadingSuggestions(true);
      try {
        const payload = await fetchArtworkSuggestions(artwork.id);
        if (!cancelled) {
          setSuggestions(payload.suggestions);
          setSuggestionsError("");
        }
      } catch (error) {
        if (!cancelled) {
          setSuggestionsError(
            error instanceof Error ? error.message : "AI 建议读取失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSuggestions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artwork.id, cloudEnabled]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setSaveError("请至少填写作品名称。");
      return;
    }

    setIsSaving(true);
    setSaveError("");
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        createdOn: createdOn || null,
        age: age.trim(),
        medium: medium.trim(),
        childQuote: childQuote.trim(),
        parentNote: parentNote.trim(),
        image: media.image ?? undefined,
        audio: media.audio ?? undefined,
        removeAudio: removeAudio || undefined,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "作品修改失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const pendingSuggestions = useMemo(
    () => suggestions.filter((item) => item.status === "pending"),
    [suggestions],
  );

  return (
    <div
      className="dialog-backdrop artwork-form-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="artwork-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-artwork-title"
        style={{ width: "min(860px, 100%)" }}
      >
        <header>
          <div>
            <p className="eyebrow">COLLECTION METADATA</p>
            <h2 id="edit-artwork-title">编辑作品资料</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭编辑窗口"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <div className="artwork-form-grid">
            <div className="upload-column">
              <ArtworkMediaEditor
                previewUrl={media.image?.preview.dataUrl ?? artwork.previewUrl ?? ""}
                title="替换作品图片"
                helperText="如需更换图片，可重新安全编码并调整旋转 / 裁切 / 焦点。"
                media={media}
                onMediaChange={setMedia}
              />
              <AudioEditor
                currentAudio={artwork.audio}
                draftAudio={media.audio}
                removeAudio={removeAudio}
                media={media}
                onMediaChange={setMedia}
                onToggleRemoveAudio={setRemoveAudio}
              />
            </div>
            <MetadataFields
              title={title}
              description={description}
              createdOn={createdOn}
              age={age}
              medium={medium}
              childQuote={childQuote}
              parentNote={parentNote}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onCreatedOnChange={setCreatedOn}
              onAgeChange={setAge}
              onMediumChange={setMedium}
              onChildQuoteChange={setChildQuote}
              onParentNoteChange={setParentNote}
            />
          </div>

          {cloudEnabled ? (
            <section className="ai-suggestion-panel">
              <div className="ai-suggestion-heading">
                <span className="callout-icon">
                  <Sparkles size={20} aria-hidden="true" />
                </span>
                <div>
                  <strong>AI 审核区</strong>
                  <p>所有标题、介绍、标签建议都必须逐项采纳或拒绝。</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void regenerateSuggestions(artwork.id, setSuggestions, setSuggestionsError, setIsGeneratingSuggestions)}
                  disabled={isGeneratingSuggestions}
                >
                  <WandSparkles size={16} aria-hidden="true" />
                  {isGeneratingSuggestions ? "正在生成…" : "重新生成建议"}
                </button>
              </div>
              {suggestionsError ? (
                <div className="ai-error">
                  <CircleHelp size={17} aria-hidden="true" />
                  {suggestionsError}
                </div>
              ) : null}
              <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                {isLoadingSuggestions ? (
                  <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 12 }}>
                    正在读取审核记录…
                  </p>
                ) : null}
                {pendingSuggestions.length === 0 && !isLoadingSuggestions ? (
                  <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 12 }}>
                    暂无待审核建议。
                  </p>
                ) : null}
                {suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    isReviewing={reviewingSuggestionId === suggestion.id}
                    onAccept={async () => {
                      setReviewingSuggestionId(suggestion.id);
                      try {
                        const result = await reviewArtworkSuggestion(
                          suggestion.id,
                          "accept",
                        );
                        setSuggestions(result.suggestions);
                        if (suggestion.type === "title") {
                          setTitle(readSuggestionText(suggestion.content));
                        } else if (suggestion.type === "description") {
                          setDescription(readSuggestionText(suggestion.content));
                        }
                        await onRefresh();
                      } catch (error) {
                        setSuggestionsError(
                          error instanceof Error
                            ? error.message
                            : "AI 建议审核失败。",
                        );
                      } finally {
                        setReviewingSuggestionId("");
                      }
                    }}
                    onReject={async () => {
                      setReviewingSuggestionId(suggestion.id);
                      try {
                        const result = await reviewArtworkSuggestion(
                          suggestion.id,
                          "reject",
                        );
                        setSuggestions(result.suggestions);
                      } catch (error) {
                        setSuggestionsError(
                          error instanceof Error
                            ? error.message
                            : "AI 建议审核失败。",
                        );
                      } finally {
                        setReviewingSuggestionId("");
                      }
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  marginTop: 16,
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    isTranscribing ||
                    artwork.audio?.status !== "ready" ||
                    media.isProcessingAudio
                  }
                  onClick={() =>
                    void transcribeArtworkAudio(
                      artwork.id,
                      setIsTranscribing,
                      setTranscriptStatus,
                      setSuggestions,
                      onRefresh,
                    )
                  }
                >
                  <Mic size={16} aria-hidden="true" />
                  {isTranscribing ? "正在转写…" : "生成录音转写"}
                </button>
                {transcriptStatus ? (
                  <p
                    style={{
                      margin: 0,
                      color: "var(--cp-text-muted)",
                      fontSize: 12,
                      alignSelf: "center",
                    }}
                  >
                    {transcriptStatus}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <footer>
            <div className="form-save-note">
              <p>
                <Clock3 size={15} aria-hidden="true" />
                草稿、发布、归档状态保持不变，未采纳的 AI 内容不会公开。
              </p>
              {saveError ? <p className="field-error">{saveError}</p> : null}
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="primary-button" disabled={isSaving}>
                {isSaving ? "正在保存…" : "保存修改"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function NewArtworkDialog({ onClose, onCreate }: NewArtworkDialogProps) {
  const [items, setItems] = useState<DraftArtworkItem[]>([]);
  const [activeItemId, setActiveItemId] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const activeItem = items.find((item) => item.id === activeItemId) ?? items[0] ?? null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    setIsPreparing(true);
    setSelectionError("");
    try {
      const nextItems: DraftArtworkItem[] = [];
      for (const file of Array.from(files)) {
        const image = await buildArtworkImageBundle(file);
        const id = crypto.randomUUID();
        nextItems.push({
          id,
          fileName: file.name,
          image,
          audio: null,
          title: file.name.replace(/\.[^.]+$/, ""),
          description: "",
          createdOn: null,
          age: "",
          medium: "",
          childQuote: "",
          parentNote: "",
          saveState: "idle",
          saveError: "",
        });
      }
      setItems((current) => {
        const merged = [...current, ...nextItems];
        if (!activeItemId && nextItems[0]) {
          setActiveItemId(nextItems[0].id);
        }
        return merged;
      });
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : "图片处理失败，请重新选择。",
      );
    } finally {
      setIsPreparing(false);
    }
  };

  const updateActiveItem = (updater: (item: DraftArtworkItem) => DraftArtworkItem) => {
    if (!activeItem) {
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === activeItem.id ? updater(item) : item)),
    );
  };

  const saveAll = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0) {
      setSelectionError("请至少选择一张作品图片。");
      return;
    }

    setIsSaving(true);
    setSelectionError("");
    const failedIds: string[] = [];
    for (const item of items) {
      if (!item.title.trim()) {
        failedIds.push(item.id);
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  saveState: "error",
                  saveError: "请至少填写作品名称。",
                }
              : currentItem,
          ),
        );
        continue;
      }

      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? { ...currentItem, saveState: "saving", saveError: "" }
            : currentItem,
        ),
      );
      try {
        await onCreate({
          title: item.title.trim(),
          description: item.description.trim(),
          createdOn: item.createdOn,
          age: item.age.trim(),
          medium: item.medium.trim(),
          childQuote: item.childQuote.trim(),
          parentNote: item.parentNote.trim(),
          image: item.image,
          audio: item.audio,
        });
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? { ...currentItem, saveState: "saved", saveError: "" }
              : currentItem,
          ),
        );
      } catch (error) {
        failedIds.push(item.id);
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  saveState: "error",
                  saveError:
                    error instanceof Error ? error.message : "作品保存失败。",
                }
              : currentItem,
          ),
        );
      }
    }

    setIsSaving(false);
    if (failedIds.length === 0) {
      onClose();
      return;
    }

    setItems((current) => current.filter((item) => failedIds.includes(item.id)));
    setActiveItemId(failedIds[0] ?? "");
  };

  return (
    <div
      className="dialog-backdrop artwork-form-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="artwork-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-artwork-title"
        style={{ width: "min(980px, 100%)" }}
      >
        <header>
          <div>
            <p className="eyebrow">NEW COLLECTION ITEM</p>
            <h2 id="new-artwork-title">批量录入作品</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭录入窗口"
            autoFocus
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={(event) => void saveAll(event)}>
          <div className="artwork-form-grid" style={{ gridTemplateColumns: "0.9fr 1.1fr" }}>
            <div className="upload-column" style={{ display: "grid", gap: 14 }}>
              <label className="artwork-upload">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => void handleFiles(event.target.files)}
                />
                <span>
                  <ImagePlus size={25} aria-hidden="true" />
                </span>
                <strong>{isPreparing ? "正在安全处理…" : "批量选择作品照片"}</strong>
                <small>支持多选；每张图会先清除 EXIF 再生成 original / display / thumbnail</small>
              </label>
              {selectionError ? <p className="field-error">{selectionError}</p> : null}
              <div className="privacy-note">
                <LockKeyhole size={17} aria-hidden="true" />
                <span>
                  只会上传浏览器重新编码后的安全图片；原始未清理文件绝不会离开本机。
                </span>
              </div>
              {items.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="secondary-button"
                      style={{
                        justifyContent: "space-between",
                        background:
                          item.id === activeItemId
                            ? "var(--cp-accent-soft)"
                            : undefined,
                      }}
                      onClick={() => setActiveItemId(item.id)}
                    >
                      <span
                        style={{
                          display: "grid",
                          justifyItems: "start",
                          gap: 2,
                          textAlign: "left",
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>{item.title || item.fileName}</strong>
                        <small>{renderSaveStateLabel(item)}</small>
                      </span>
                      {item.saveState === "error" ? (
                        <CircleHelp size={16} aria-hidden="true" />
                      ) : item.saveState === "saved" ? (
                        <Check size={16} aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {activeItem ? (
              <DraftArtworkEditor
                item={activeItem}
                onItemChange={(updater) => updateActiveItem(updater)}
              />
            ) : (
              <div className="fields-column" style={{ alignContent: "center" }}>
                <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 12 }}>
                  选择一张或多张图片后，即可分别调整每件作品的裁切、焦点、音频和文字。
                </p>
              </div>
            )}
          </div>

          <section className="ai-suggestion-panel">
            <div className="ai-suggestion-heading">
              <span className="callout-icon">
                <Sparkles size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>AI 建议稍后生成</strong>
                <p>先把作品保存为草稿，再进入单件编辑逐项审核标题 / 介绍 / 标签。</p>
              </div>
            </div>
          </section>

          <footer>
            <div className="form-save-note">
              <p>
                <Clock3 size={15} aria-hidden="true" />
                批量保存会逐件反馈失败，不会伪成功
              </p>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={isSaving || isPreparing || items.length === 0}
              >
                {isSaving ? "正在逐件保存…" : `保存 ${items.length || ""} 件作品`}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DraftArtworkEditor({
  item,
  onItemChange,
}: {
  item: DraftArtworkItem;
  onItemChange: (updater: (item: DraftArtworkItem) => DraftArtworkItem) => void;
}) {
  return (
    <div className="fields-column">
      <ArtworkMediaEditor
        previewUrl={item.image.preview.dataUrl}
        title="作品图片"
        helperText="支持 90° 旋转、裁切范围和焦点位置调整。"
        media={{
          image: item.image,
          audio: item.audio,
          imageError: item.saveError,
          audioError: "",
          isProcessingImage: false,
          isProcessingAudio: false,
          editor: {
            rotation: item.image.rotation,
            crop: item.image.crop,
            focusX: item.image.focusX,
            focusY: item.image.focusY,
          },
        }}
        onMediaChange={(media) =>
          onItemChange((current) => ({
            ...current,
            image: media.image ?? current.image,
            audio: media.audio,
          }))
        }
      />
      <MetadataFields
        title={item.title}
        description={item.description}
        createdOn={item.createdOn ?? ""}
        age={item.age}
        medium={item.medium}
        childQuote={item.childQuote}
        parentNote={item.parentNote}
        onTitleChange={(value) => onItemChange((current) => ({ ...current, title: value }))}
        onDescriptionChange={(value) =>
          onItemChange((current) => ({ ...current, description: value }))
        }
        onCreatedOnChange={(value) =>
          onItemChange((current) => ({ ...current, createdOn: value || null }))
        }
        onAgeChange={(value) => onItemChange((current) => ({ ...current, age: value }))}
        onMediumChange={(value) => onItemChange((current) => ({ ...current, medium: value }))}
        onChildQuoteChange={(value) =>
          onItemChange((current) => ({ ...current, childQuote: value }))
        }
        onParentNoteChange={(value) =>
          onItemChange((current) => ({ ...current, parentNote: value }))
        }
      />
      <AudioEditor
        currentAudio={null}
        draftAudio={item.audio}
        removeAudio={false}
        media={{
          image: item.image,
          audio: item.audio,
          imageError: "",
          audioError: "",
          isProcessingImage: false,
          isProcessingAudio: false,
          editor: defaultImageEditorState,
        }}
        onMediaChange={(media) =>
          onItemChange((current) => ({
            ...current,
            audio: media.audio,
          }))
        }
        onToggleRemoveAudio={() => undefined}
      />
      {item.saveError ? <p className="field-error">{item.saveError}</p> : null}
    </div>
  );
}

function MetadataFields(props: {
  title: string;
  description: string;
  createdOn: string;
  age: string;
  medium: string;
  childQuote: string;
  parentNote: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreatedOnChange: (value: string) => void;
  onAgeChange: (value: string) => void;
  onMediumChange: (value: string) => void;
  onChildQuoteChange: (value: string) => void;
  onParentNoteChange: (value: string) => void;
}) {
  return (
    <div className="fields-column">
      <div className="form-row">
        <label>
          <span>作品名称</span>
          <input
            value={props.title}
            onChange={(event) => props.onTitleChange(event.target.value)}
            maxLength={80}
          />
        </label>
        <label>
          <span>创作日期</span>
          <input
            type="date"
            value={props.createdOn}
            onChange={(event) => props.onCreatedOnChange(event.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>创作时年龄</span>
          <input
            value={props.age}
            onChange={(event) => props.onAgeChange(event.target.value)}
            maxLength={40}
          />
        </label>
        <label>
          <span>材料 / 媒介</span>
          <input
            value={props.medium}
            onChange={(event) => props.onMediumChange(event.target.value)}
            maxLength={80}
          />
        </label>
      </div>
      <label>
        <span>作品介绍</span>
        <textarea
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          rows={3}
          maxLength={1000}
        />
      </label>
      <label>
        <span>孩子原话</span>
        <textarea
          value={props.childQuote}
          onChange={(event) => props.onChildQuoteChange(event.target.value)}
          rows={3}
          maxLength={500}
        />
      </label>
      <label>
        <span>家长备注（不会发送给 AI）</span>
        <textarea
          value={props.parentNote}
          onChange={(event) => props.onParentNoteChange(event.target.value)}
          rows={3}
          maxLength={1000}
        />
      </label>
    </div>
  );
}

function ArtworkMediaEditor({
  previewUrl,
  title,
  helperText,
  media,
  onMediaChange,
}: {
  previewUrl: string;
  title: string;
  helperText: string;
  media: MediaDraftState;
  onMediaChange: (value: MediaDraftState) => void;
}) {
  const handleReplacement = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    onMediaChange({ ...media, isProcessingImage: true, imageError: "" });
    try {
      const image = await buildArtworkImageBundle(file, media.editor);
      onMediaChange({
        ...media,
        image,
        isProcessingImage: false,
        imageError: "",
      });
    } catch (error) {
      onMediaChange({
        ...media,
        isProcessingImage: false,
        imageError:
          error instanceof Error ? error.message : "图片处理失败，请重新选择。",
      });
    }
  };

  const updateEditor = async (partial: Partial<ImageEditorState>) => {
    if (!media.image) {
      onMediaChange({
        ...media,
        editor: {
          ...media.editor,
          ...partial,
          crop: partial.crop ?? media.editor.crop,
        },
      });
      return;
    }
    const file = await dataUrlToFile(media.image.original.dataUrl, "artwork.webp");
    const nextEditor = {
      ...media.editor,
      ...partial,
      crop: partial.crop ?? media.editor.crop,
    };
    onMediaChange({ ...media, isProcessingImage: true, editor: nextEditor });
    try {
      const image = await buildArtworkImageBundle(file, nextEditor);
      onMediaChange({
        ...media,
        image,
        editor: nextEditor,
        isProcessingImage: false,
        imageError: "",
      });
    } catch (error) {
      onMediaChange({
        ...media,
        editor: nextEditor,
        isProcessingImage: false,
        imageError:
          error instanceof Error ? error.message : "图片处理失败，请重新选择。",
      });
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label className={`artwork-upload ${previewUrl ? "has-image" : ""}`}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => void handleReplacement(event.target.files?.[0])}
        />
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt={title}
            fill
            sizes="(max-width: 900px) 100vw, 40vw"
            unoptimized
          />
        ) : (
          <>
            <span>
              <Upload size={25} aria-hidden="true" />
            </span>
            <strong>{media.isProcessingImage ? "正在安全处理…" : title}</strong>
            <small>JPG、PNG 或 WebP，最大 20 MB</small>
          </>
        )}
      </label>
      <div className="privacy-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <span>{helperText}</span>
      </div>
      {media.image ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void updateEditor({
                  rotation: ((media.editor.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                })
              }
            >
              <RotateCw size={16} aria-hidden="true" />
              旋转 90°
            </button>
          </div>
          <label>
            <span>裁切宽度</span>
            <input
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              value={media.editor.crop.width}
              onChange={(event) =>
                void updateEditor({
                  crop: {
                    ...media.editor.crop,
                    width: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            <span>裁切高度</span>
            <input
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              value={media.editor.crop.height}
              onChange={(event) =>
                void updateEditor({
                  crop: {
                    ...media.editor.crop,
                    height: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            <span>裁切横向位置</span>
            <input
              type="range"
              min="0"
              max={Math.max(0, 1 - media.editor.crop.width)}
              step="0.05"
              value={media.editor.crop.x}
              onChange={(event) =>
                void updateEditor({
                  crop: {
                    ...media.editor.crop,
                    x: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            <span>裁切纵向位置</span>
            <input
              type="range"
              min="0"
              max={Math.max(0, 1 - media.editor.crop.height)}
              step="0.05"
              value={media.editor.crop.y}
              onChange={(event) =>
                void updateEditor({
                  crop: {
                    ...media.editor.crop,
                    y: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            <span>焦点横向</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={media.editor.focusX}
              onChange={(event) =>
                void updateEditor({ focusX: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>焦点纵向</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={media.editor.focusY}
              onChange={(event) =>
                void updateEditor({ focusY: Number(event.target.value) })
              }
            />
          </label>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 11 }}>
            <Scissors size={14} aria-hidden="true" style={{ marginRight: 6 }} />
            将保存安全 original、display、thumbnail 三份 WebP。
          </p>
        </div>
      ) : null}
      {media.imageError ? <p className="field-error">{media.imageError}</p> : null}
    </div>
  );
}

function AudioEditor({
  currentAudio,
  draftAudio,
  removeAudio,
  media,
  onMediaChange,
  onToggleRemoveAudio,
}: {
  currentAudio: StudioArtwork["audio"] | null | undefined;
  draftAudio: CreateArtworkPayload["audio"] | null;
  removeAudio: boolean;
  media: MediaDraftState;
  onMediaChange: (value: MediaDraftState) => void;
  onToggleRemoveAudio: (value: boolean) => void;
}) {
  const handleAudio = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    onMediaChange({ ...media, isProcessingAudio: true, audioError: "" });
    try {
      const audio = await buildArtworkAudioInput(file);
      onMediaChange({
        ...media,
        audio,
        isProcessingAudio: false,
        audioError: "",
      });
      onToggleRemoveAudio(false);
    } catch (error) {
      onMediaChange({
        ...media,
        isProcessingAudio: false,
        audioError:
          error instanceof Error ? error.message : "音频处理失败，请重试。",
      });
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label>
        <span>原声录音（可选）</span>
        <span className="audio-input">
          <FileAudio size={18} aria-hidden="true" />
          <input
            type="file"
            accept="audio/webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg"
            capture
            onChange={(event) => void handleAudio(event.target.files?.[0])}
          />
        </span>
      </label>
      <div style={{ display: "grid", gap: 4 }}>
        {draftAudio ? (
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 11 }}>
            已准备音频：{draftAudio.mimeType} · {Math.round(draftAudio.durationSeconds)} 秒
          </p>
        ) : currentAudio?.status === "ready" && !removeAudio ? (
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 11 }}>
            当前云端音频：{currentAudio.mimeType} · {Math.round(currentAudio.durationSeconds ?? 0)} 秒
          </p>
        ) : (
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 11 }}>
            尚未附加音频。
          </p>
        )}
      </div>
      {currentAudio?.status === "ready" ? (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--cp-text-muted)",
            fontSize: 11,
          }}
        >
          <input
            type="checkbox"
            checked={removeAudio}
            onChange={(event) => onToggleRemoveAudio(event.target.checked)}
          />
          删除现有云端音频
        </label>
      ) : null}
      {media.audioError ? <p className="field-error">{media.audioError}</p> : null}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  isReviewing,
  onAccept,
  onReject,
}: {
  suggestion: StudioSuggestion;
  isReviewing: boolean;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const label =
    suggestion.type === "title"
      ? "建议标题"
      : suggestion.type === "description"
        ? "建议介绍"
        : suggestion.type === "tags"
          ? "建议标签"
          : suggestion.type === "transcript"
            ? "录音转写"
            : "审核记录";

  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        background: "var(--cp-surface)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span style={{ color: "var(--cp-text-muted)", fontSize: 11 }}>
          {statusLabel(suggestion.status)} · v{suggestion.sourceVersion}
        </span>
      </div>
      <div style={{ color: "var(--cp-text-muted)", fontSize: 12 }}>
        {renderSuggestionContent(suggestion)}
      </div>
      {suggestion.status === "pending" ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary-button"
            disabled={isReviewing}
            onClick={() => void onAccept()}
          >
            <Check size={15} aria-hidden="true" />
            {isReviewing ? "处理中…" : "采纳"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isReviewing}
            onClick={() => void onReject()}
          >
            <Trash2 size={15} aria-hidden="true" />
            拒绝
          </button>
        </div>
      ) : null}
    </div>
  );
}

function renderSuggestionContent(suggestion: StudioSuggestion) {
  if (suggestion.type === "tags") {
    const tags = readSuggestionTags(suggestion.content);
    return (
      <div className="suggestion-tags">
        {tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    );
  }
  return <p style={{ margin: 0 }}>{readSuggestionText(suggestion.content)}</p>;
}

function readSuggestionText(content: unknown) {
  const parsed = z
    .object({
      value: z.string().default(""),
    })
    .safeParse(content);
  return parsed.success ? parsed.data.value : "";
}

function readSuggestionTags(content: unknown) {
  const parsed = z
    .object({
      values: z.array(z.string()).default([]),
    })
    .safeParse(content);
  return parsed.success ? parsed.data.values : [];
}

function renderSaveStateLabel(item: DraftArtworkItem) {
  if (item.saveState === "saving") {
    return "正在保存…";
  }
  if (item.saveState === "saved") {
    return "已保存为草稿";
  }
  if (item.saveState === "error") {
    return item.saveError || "保存失败";
  }
  return "等待保存";
}

function statusLabel(status: StudioSuggestion["status"]) {
  return (
    {
      pending: "待审核",
      accepted: "已采纳",
      rejected: "已拒绝",
      stale: "已过期",
    } satisfies Record<StudioSuggestion["status"], string>
  )[status];
}

async function regenerateSuggestions(
  artworkId: string,
  setSuggestions: (suggestions: StudioSuggestion[]) => void,
  setError: (value: string) => void,
  setLoading: (value: boolean) => void,
) {
  setLoading(true);
  setError("");
  try {
    const payload = await generateArtworkSuggestions(artworkId);
    setSuggestions(payload.suggestions);
  } catch (error) {
    setError(error instanceof Error ? error.message : "AI 建议生成失败。");
  } finally {
    setLoading(false);
  }
}

async function transcribeArtworkAudio(
  artworkId: string,
  setLoading: (value: boolean) => void,
  setStatus: (value: string) => void,
  setSuggestions: (suggestions: StudioSuggestion[]) => void,
  onRefresh: () => Promise<void>,
) {
  setLoading(true);
  setStatus("");
  try {
    const payload = await requestArtworkTranscription(artworkId);
    setSuggestions(payload.suggestions);
    setStatus("转写完成，已写入 transcript 记录并等待审核。");
    await onRefresh();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "录音转写失败。");
  } finally {
    setLoading(false);
  }
}

async function dataUrlToFile(dataUrl: string, name: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/webp" });
}
