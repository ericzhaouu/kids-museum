"use client";

import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  ImagePlus,
  Images,
  LayoutDashboard,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
  Users,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArtworkVisual } from "@/components/artwork-visual";
import { StudioExhibitionsPanel } from "@/components/studio-exhibitions-panel";
import {
  EditArtworkDialog,
  NewArtworkDialog,
} from "@/components/studio-artwork-dialogs";
import {
  createDefaultMediaState,
  type CreateArtworkPayload,
  type PatchArtworkPayload,
  type StudioArtwork,
} from "@/lib/artworks/contracts";
import {
  type ArtworkMutationResult,
  createArtworkRequest,
  updateArtworkRequest,
} from "@/lib/artworks/client";
import {
  DELETE_MUSEUM_CONFIRMATION_PHRASE,
  type CuratorMuseumProfile,
} from "@/lib/museum-management";
import { featuredExhibition, type ArtworkVisual as VisualName } from "@/lib/museum-data";

type StudioInvitation = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
  visitorSessionCount: number;
  activeVisitorSessionCount: number;
  latestVisitAt: string | null;
};

const initialArtworks: StudioArtwork[] = featuredExhibition.rooms.flatMap((room) =>
  room.artworks.map((artwork) => ({
    id: artwork.id,
    title: artwork.title,
    description: artwork.description,
    createdOn: null,
    createdOnLabel: artwork.createdAt,
      age: artwork.age,
      medium: artwork.medium,
      status: "published" as const,
      visual: artwork.visual,
      tags: [],
      sourceVersion: 1,
      media: {
        original: null,
        display: null,
        thumbnail: null,
        audio: null,
        ...createDefaultMediaState(),
      },
      audio: { status: "missing" },
      childQuote: artwork.childQuote,
    })),
);

const statusLabel: Record<StudioArtwork["status"], string> = {
  published: "已展出",
  draft: "草稿",
  archived: "已归档",
};

const invitationStatusLabel: Record<StudioInvitation["status"], string> = {
  active: "有效",
  expired: "已过期",
  revoked: "已撤销",
};

const inlineLabelStyle = {
  display: "grid",
  gap: 5,
  color: "var(--cp-text-muted)",
  fontSize: 10,
} as const;

function formatArtworkDate(artwork: StudioArtwork): string {
  if (artwork.createdOn) {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${artwork.createdOn}T00:00:00.000Z`));
  }
  return artwork.createdOnLabel ?? "待补充";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLatestVisit(invitations: StudioInvitation[]): string {
  const latestVisitAt = invitations.reduce<string | null>(
    (latest, invitation) =>
      invitation.latestVisitAt &&
      (!latest || new Date(invitation.latestVisitAt) > new Date(latest))
        ? invitation.latestVisitAt
        : latest,
    null,
  );
  return latestVisitAt
    ? `最近真实访问：${formatDateTime(latestVisitAt)}`
    : "尚无真实访问记录";
}

type StudioDashboardProps = {
  cloudEnabled: boolean;
};

export function StudioDashboard({ cloudEnabled }: StudioDashboardProps) {
  const [museum, setMuseum] = useState<CuratorMuseumProfile | null>(null);
  const [artworks, setArtworks] = useState(initialArtworks);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArtwork, setEditingArtwork] = useState<StudioArtwork | null>(null);
  const [invitations, setInvitations] = useState<StudioInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(cloudEnabled);
  const [invitationStatus, setInvitationStatus] = useState("");
  const [isCreatingInvitation, setIsCreatingInvitation] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState("");
  const [invitationDays, setInvitationDays] = useState<1 | 7 | 30>(7);
  const [newInvitationUrl, setNewInvitationUrl] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [museumNameInput, setMuseumNameInput] = useState("新的小小博物馆");
  const [artistNicknameInput, setArtistNicknameInput] = useState("小小策展人");
  const [museumSetupStatus, setMuseumSetupStatus] = useState("");
  const [isCreatingMuseum, setIsCreatingMuseum] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeletingMuseum, setIsDeletingMuseum] = useState(false);
  const [syncStatus, setSyncStatus] = useState(
    cloudEnabled ? "正在读取私密馆藏…" : "本地预览模式",
  );
  const [artworksLoadState, setArtworksLoadState] = useState<
    "loading" | "ready" | "error"
  >(cloudEnabled ? "loading" : "ready");
  const [activeFilter, setActiveFilter] = useState<"all" | StudioArtwork["status"]>(
    "all",
  );

  const visibleArtworks = useMemo(
    () =>
      activeFilter === "all"
        ? artworks
        : artworks.filter((artwork) => artwork.status === activeFilter),
    [activeFilter, artworks],
  );

  const refreshCloudArtworks = async () => {
    const response = await fetch("/api/artworks", { cache: "no-store" });
    const payload = (await response.json()) as
      | { artworks: StudioArtwork[] }
      | { error: string };
    if (!response.ok || !("artworks" in payload)) {
      throw new Error("error" in payload ? payload.error : "作品读取失败。");
    }
    setArtworks(payload.artworks);
    setArtworksLoadState("ready");
    return payload.artworks;
  };

  useEffect(() => {
    if (!cloudEnabled) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const museumResponse = await fetch("/api/museum", { cache: "no-store" });
        const museumPayload = (await museumResponse.json()) as
          | {
              museum: CuratorMuseumProfile | null;
              canInitialize: boolean;
            }
          | { error: string };
        if (!museumResponse.ok || !("museum" in museumPayload)) {
          throw new Error(
            "error" in museumPayload
              ? museumPayload.error
              : "博物馆资料读取失败。",
          );
        }

        if (!cancelled) {
          setMuseum(museumPayload.museum);
        }

        if (!museumPayload.museum) {
          if (!cancelled) {
            setArtworks([]);
            setInvitations([]);
            setArtworksLoadState("ready");
            setInvitationsLoading(false);
            setSyncStatus("当前账号尚未初始化博物馆");
          }
          return;
        }

        await refreshCloudArtworks();
        if (!cancelled) {
          setSyncStatus("已连接私密云端");
        }
      } catch (error) {
        if (!cancelled) {
          setArtworksLoadState("error");
          setSyncStatus(
            error instanceof Error ? error.message : "作品读取失败。",
          );
        }
      }
    })();

    void fetch("/api/museum", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as
          | { museum: CuratorMuseumProfile | null }
          | { error: string };
        if (!response.ok || !("museum" in payload)) {
          throw new Error("error" in payload ? payload.error : "博物馆资料读取失败。");
        }
        if (!payload.museum) {
          return;
        }

        return fetch("/api/invitations")
          .then(async (invitationResponse) => {
            const invitationPayload = (await invitationResponse.json()) as
              | { invitations: StudioInvitation[] }
              | { error: string };
            if (!invitationResponse.ok || !("invitations" in invitationPayload)) {
              throw new Error(
                "error" in invitationPayload
                  ? invitationPayload.error
                  : "邀请读取失败。",
              );
            }
            if (!cancelled) {
              setInvitations(invitationPayload.invitations);
            }
          })
          .finally(() => {
            if (!cancelled) {
              setInvitationsLoading(false);
            }
          });
      })
      .catch((error) => {
        if (!cancelled) {
          setInvitationStatus(
            error instanceof Error ? error.message : "邀请读取失败。",
          );
          setInvitationsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cloudEnabled]);

  const addArtwork = async (input: CreateArtworkPayload) => {
    let artwork: StudioArtwork;
    if (cloudEnabled) {
      const result: ArtworkMutationResult = await createArtworkRequest(input);
      artwork = result.artwork;
      setSyncStatus(
        result.warning ?? "作品已保存到私密云端",
      );
    } else {
      artwork = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description,
        createdOn: input.createdOn,
        age: input.age || "年龄待补充",
        medium: input.medium || "媒介待补充",
        status: "draft",
        previewUrl: input.image.display.dataUrl,
        originalUrl: input.image.original.dataUrl,
        thumbnailUrl: input.image.thumbnail.dataUrl,
        childQuote: input.childQuote,
        parentNote: input.parentNote,
        tags: [],
        sourceVersion: 1,
        audio: input.audio
          ? {
              status: "ready",
              mimeType: input.audio.mimeType,
              durationSeconds: input.audio.durationSeconds,
            }
          : { status: "missing" },
        media: {
          original: {
            kind: "original",
            mimeType: "image/webp",
            byteSize: input.image.original.dataUrl.length,
            width: input.image.original.width,
            height: input.image.original.height,
            signedUrl: input.image.original.dataUrl,
          },
          display: {
            kind: "display",
            mimeType: "image/webp",
            byteSize: input.image.display.dataUrl.length,
            width: input.image.display.width,
            height: input.image.display.height,
            signedUrl: input.image.display.dataUrl,
          },
          thumbnail: {
            kind: "thumbnail",
            mimeType: "image/webp",
            byteSize: input.image.thumbnail.dataUrl.length,
            width: input.image.thumbnail.width,
            height: input.image.thumbnail.height,
            signedUrl: input.image.thumbnail.dataUrl,
          },
          audio: input.audio
            ? {
                kind: "audio",
                mimeType: input.audio.mimeType,
                byteSize: input.audio.byteSize,
                durationSeconds: input.audio.durationSeconds,
              }
            : null,
          focusX: input.image.focusX,
          focusY: input.image.focusY,
          rotation: input.image.rotation,
          crop: input.image.crop,
        },
      };
      setSyncStatus("仅保存于当前本地预览会话");
    }

    setArtworks((current) => [artwork, ...current]);
    setActiveFilter("all");
  };

  const deleteArtwork = async (artwork: StudioArtwork) => {
    if (!window.confirm(`确定删除《${artwork.title}》吗？此操作不可撤销。`)) {
      return;
    }
    if (cloudEnabled) {
      const response = await fetch(`/api/artworks/${artwork.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as
        | { deleted: true; mediaCleanupPending: boolean }
        | { error: string };
      if (!response.ok || !("deleted" in payload)) {
        setSyncStatus(
          "error" in payload ? payload.error : "作品删除失败。",
        );
        return;
      }
      setSyncStatus(
        payload.mediaCleanupPending
          ? "作品档案已删除，旧媒体已登记清理队列并会用 service role 重试"
          : "作品及其私密媒体已删除",
      );
    }
    setArtworks((current) =>
      current.filter((currentArtwork) => currentArtwork.id !== artwork.id),
    );
  };

  const updateArtwork = async (
    artwork: StudioArtwork,
    updates: PatchArtworkPayload,
  ) => {
    let updatedArtwork: StudioArtwork;
    if (cloudEnabled) {
      const payload = await updateArtworkRequest(artwork.id, updates);
      updatedArtwork = {
        ...artwork,
        ...payload.artwork,
        createdOnLabel: undefined,
      };
      setSyncStatus(payload.warning ?? "作品资料已更新到私密云端");
    } else {
      updatedArtwork = {
        ...artwork,
        title: updates.title ?? artwork.title,
        description: updates.description ?? artwork.description,
        createdOn:
          updates.createdOn !== undefined ? updates.createdOn : artwork.createdOn,
        age: updates.age ?? artwork.age,
        medium: updates.medium ?? artwork.medium,
        childQuote:
          updates.childQuote !== undefined ? updates.childQuote : artwork.childQuote,
        parentNote:
          updates.parentNote !== undefined ? updates.parentNote : artwork.parentNote,
        status: updates.status ?? artwork.status,
        previewUrl: updates.image?.display.dataUrl ?? artwork.previewUrl,
        originalUrl: updates.image?.original.dataUrl ?? artwork.originalUrl,
        thumbnailUrl: updates.image?.thumbnail.dataUrl ?? artwork.thumbnailUrl,
        audio: updates.removeAudio
          ? { status: "missing" }
          : updates.audio
            ? {
                status: "ready",
                mimeType: updates.audio.mimeType,
                durationSeconds: updates.audio.durationSeconds,
              }
            : artwork.audio,
        media: updates.image
          ? {
              original: {
                kind: "original",
                mimeType: "image/webp",
                byteSize: updates.image.original.dataUrl.length,
                width: updates.image.original.width,
                height: updates.image.original.height,
                signedUrl: updates.image.original.dataUrl,
              },
              display: {
                kind: "display",
                mimeType: "image/webp",
                byteSize: updates.image.display.dataUrl.length,
                width: updates.image.display.width,
                height: updates.image.display.height,
                signedUrl: updates.image.display.dataUrl,
              },
              thumbnail: {
                kind: "thumbnail",
                mimeType: "image/webp",
                byteSize: updates.image.thumbnail.dataUrl.length,
                width: updates.image.thumbnail.width,
                height: updates.image.thumbnail.height,
                signedUrl: updates.image.thumbnail.dataUrl,
              },
              audio: updates.audio
                ? {
                    kind: "audio",
                    mimeType: updates.audio.mimeType,
                    byteSize: updates.audio.byteSize,
                    durationSeconds: updates.audio.durationSeconds,
                  }
                : updates.removeAudio
                  ? null
                  : artwork.media.audio,
              focusX: updates.image.focusX,
              focusY: updates.image.focusY,
              rotation: updates.image.rotation,
              crop: updates.image.crop,
            }
          : artwork.media,
        sourceVersion:
          updates.image ||
          updates.audio ||
          updates.removeAudio ||
          updates.createdOn !== undefined ||
          updates.age !== undefined ||
          updates.medium !== undefined ||
          updates.childQuote !== undefined ||
          updates.parentNote !== undefined
            ? artwork.sourceVersion + 1
            : artwork.sourceVersion,
        createdOnLabel:
          updates.createdOn !== undefined ? undefined : artwork.createdOnLabel,
      };
      setSyncStatus("作品修改仅保存在当前本地预览会话");
    }

    setArtworks((current) =>
      current.map((item) => (item.id === artwork.id ? updatedArtwork : item)),
    );
  };

  const createFamilyInvitation = async () => {
    if (!cloudEnabled) {
      setInvitationStatus("本地预览不会创建可访问的真实邀请。");
      return;
    }
    setIsCreatingInvitation(true);
    setInvitationStatus("");
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: `家庭邀请（${invitationDays} 天）`,
          validDays: invitationDays,
        }),
      });
      const payload = (await response.json()) as
        | { invitation: StudioInvitation & { url: string } }
        | { error: string };
      if (!response.ok || !("invitation" in payload)) {
        throw new Error(
          "error" in payload ? payload.error : "邀请创建失败。",
        );
      }
      const { url, ...invitation } = payload.invitation;
      setInvitations((current) => [invitation, ...current]);
      setNewInvitationUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setInvitationStatus(`邀请链接已复制，${invitationDays} 天内有效。`);
      } catch {
        setInvitationStatus("邀请已创建。自动复制失败，请使用下方链接手动复制。");
      }
    } catch (error) {
      setInvitationStatus(
        error instanceof Error ? error.message : "邀请创建失败。",
      );
    } finally {
      setIsCreatingInvitation(false);
    }
  };

  const copyInvitationUrl = async () => {
    try {
      await navigator.clipboard.writeText(newInvitationUrl);
      setInvitationStatus("邀请链接已复制。");
    } catch {
      setInvitationStatus("浏览器未允许复制；链接仍显示在下方，可手动选择复制。");
    }
  };

  const revokeInvitation = async (invitation: StudioInvitation) => {
    if (
      !window.confirm(`确定撤销“${invitation.label}”吗？现有访客会话也会立即失效。`)
    ) {
      return;
    }

    setRevokingInvitationId(invitation.id);
    setInvitationStatus("");
    try {
      const response = await fetch(`/api/invitations/${invitation.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as
        | { revoked: true; revokedAt: string }
        | { error: string };
      if (!response.ok || !("revoked" in payload)) {
        throw new Error(
          "error" in payload ? payload.error : "邀请撤销失败。",
        );
      }
      setInvitations((current) =>
        current.map((item) =>
          item.id === invitation.id
            ? {
                ...item,
                status: "revoked",
                revokedAt: payload.revokedAt,
                activeVisitorSessionCount: 0,
              }
            : item,
        ),
      );
      setInvitationStatus("邀请及其现有访客会话已撤销。");
    } catch (error) {
      setInvitationStatus(
        error instanceof Error ? error.message : "邀请撤销失败。",
      );
    } finally {
      setRevokingInvitationId("");
    }
  };

  const downloadPrivateExport = async () => {
    if (!cloudEnabled) {
      setExportStatus("本地预览没有可导出的云端私密数据。");
      return;
    }

    setIsExporting(true);
    setExportStatus("");
    try {
      const response = await fetch("/api/artworks/export");
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "数据导出失败。");
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/);
      anchor.download =
        fileNameMatch?.[1] ??
        `kids-museum-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      setExportStatus(
        "完整私密备份 ZIP 已导出：包含元数据与已登记私密媒体，但不含 token hash、session hash 或签名链接。",
      );
    } catch (error) {
      setExportStatus(
        error instanceof Error ? error.message : "数据导出失败。",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const createMuseum = async () => {
    if (!cloudEnabled) {
      return;
    }
    setIsCreatingMuseum(true);
    setMuseumSetupStatus("");
    try {
      const response = await fetch("/api/museum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: museumNameInput,
          artistNickname: artistNicknameInput,
          themeId: "warm-gallery",
        }),
      });
      const payload = (await response.json()) as
        | { museum: CuratorMuseumProfile }
        | { error: string };
      if (!response.ok || !("museum" in payload)) {
        throw new Error("error" in payload ? payload.error : "博物馆初始化失败。");
      }
      setMuseum(payload.museum);
      setMuseumSetupStatus("新的私密博物馆已创建，可以继续录入和布展。");
      await refreshCloudArtworks();
      setSyncStatus("已连接私密云端");
    } catch (error) {
      setMuseumSetupStatus(
        error instanceof Error ? error.message : "博物馆初始化失败。",
      );
    } finally {
      setIsCreatingMuseum(false);
    }
  };

  const deleteMuseum = async () => {
    if (!museum) {
      return;
    }
    if (
      !window.confirm(
        "全馆永久删除会移除全部作品、展览、邀请、访客会话、AI 建议与审计记录，仅保留登录账号本身。确定继续吗？",
      )
    ) {
      return;
    }

    setIsDeletingMuseum(true);
    setMuseumSetupStatus("");
    try {
      const response = await fetch("/api/museum", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: deleteConfirmationText }),
      });
      const payload = (await response.json()) as
        | { deleted: true; preservedAuthUser: boolean }
        | { error: string };
      if (!response.ok || !("deleted" in payload)) {
        throw new Error("error" in payload ? payload.error : "全馆删除失败。");
      }

      setMuseum(null);
      setArtworks([]);
      setInvitations([]);
      setDeleteConfirmationText("");
      setMuseumSetupStatus(
        "全馆数据已删除，登录账号已保留。你现在可以重新初始化一座新的博物馆。",
      );
      setSyncStatus("当前账号尚未初始化博物馆");
    } catch (error) {
      setMuseumSetupStatus(
        error instanceof Error ? error.message : "全馆删除失败。",
      );
    } finally {
      setIsDeletingMuseum(false);
    }
  };

  return (
    <main className="studio-shell">
      <aside className="studio-sidebar">
        <Link className="studio-brand" href="/">
          <span className="brand-seal">兮</span>
          <span>
            <strong>小小博物馆</strong>
            <small>馆长工作台</small>
          </span>
        </Link>
        <nav className="studio-nav" aria-label="馆长台导航">
          <a className="is-active" href="#overview">
            <LayoutDashboard size={18} aria-hidden="true" />
            总览
          </a>
          <a href="#artworks">
            <Images size={18} aria-hidden="true" />
            作品库
            <span>{artworks.length}</span>
          </a>
          <a href="#exhibitions">
            <Archive size={18} aria-hidden="true" />
            展览
            <span>1</span>
          </a>
          <a href="#family">
            <Users size={18} aria-hidden="true" />
            家人邀请
          </a>
        </nav>
        <div className="studio-sidebar-footer">
          <button
            type="button"
            onClick={() => void downloadPrivateExport()}
            disabled={isExporting}
          >
            <Download size={17} aria-hidden="true" />
            {isExporting ? "正在导出…" : "导出私密数据"}
          </button>
          <Link href="/">
            <ArrowLeft size={17} aria-hidden="true" />
            返回展厅
          </Link>
        </div>
      </aside>

      <div className="studio-main">
        <header className="studio-header">
          <div>
            <p className="eyebrow">CURATOR STUDIO</p>
            <h1>{museum ? `你好，${museum.artistNickname}` : "先创建一座新的博物馆"}</h1>
            <p>兮爷的灵感档案，都在这里被好好保存。</p>
            <span className="sync-status">
              <LockKeyhole size={12} aria-hidden="true" />
              {syncStatus}
            </span>
            {exportStatus ? (
              <span className="sync-status" role="status">
                {exportStatus}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => setDialogOpen(true)}
            disabled={cloudEnabled && !museum}
          >
            <Plus size={18} aria-hidden="true" />
            录入新作品
          </button>
        </header>

        {cloudEnabled && !museum ? (
          <section className="studio-panel" style={{ display: "grid", gap: 16 }}>
            <div className="panel-heading">
              <span className="panel-icon">
                <LockKeyhole size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>初始化私密博物馆</strong>
                <small className="panel-status panel-status--published">
                  账号已保留，馆藏尚未创建
                </small>
              </div>
            </div>
            <p>
              全馆永久删除后不会自动重建资料。请先填写新的博物馆名称和馆长昵称，再继续录入作品。
            </p>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <label style={inlineLabelStyle}>
                博物馆名称
                <input
                  value={museumNameInput}
                  onChange={(event) => setMuseumNameInput(event.target.value)}
                />
              </label>
              <label style={inlineLabelStyle}>
                馆长昵称
                <input
                  value={artistNicknameInput}
                  onChange={(event) => setArtistNicknameInput(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => void createMuseum()}
              disabled={isCreatingMuseum}
              style={{ width: "fit-content" }}
            >
              {isCreatingMuseum ? "正在创建…" : "创建新的私密博物馆"}
            </button>
            {museumSetupStatus ? (
              <p className="empty-state-note" role="status">
                {museumSetupStatus}
              </p>
            ) : null}
          </section>
        ) : null}

        {cloudEnabled && museum ? (
          <section className="studio-panel" style={{ display: "grid", gap: 14 }}>
            <div className="panel-heading">
              <span className="panel-icon">
                <Download size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>备份与永久删除</strong>
                <small className="panel-status panel-status--draft">
                  仅馆长可执行
                </small>
              </div>
            </div>
            <p>
              导出的 ZIP 包含馆档、作品、备注、标签、AI 建议、展览、邀请、审计事件与全部已登记私密媒体。文件含私密内容，请仅存放在受控位置。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void downloadPrivateExport()}
                disabled={isExporting}
              >
                <Download size={16} aria-hidden="true" />
                {isExporting ? "正在导出…" : "导出完整私密备份 ZIP"}
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 12,
                borderRadius: "0.875rem",
                border: "1px solid color-mix(in srgb, var(--cp-danger) 30%, var(--cp-border))",
                background: "color-mix(in srgb, var(--cp-danger) 5%, var(--cp-surface))",
              }}
            >
              <strong style={{ color: "var(--cp-danger)" }}>全馆永久删除</strong>
              <p style={{ margin: 0 }}>
                输入“{museum.name}”或“{DELETE_MUSEUM_CONFIRMATION_PHRASE}”后，服务器会再次校验当前登录馆长，并删除整座博物馆；仅保留登录账号，可稍后重新初始化。
              </p>
              <label style={inlineLabelStyle}>
                删除确认
                <input
                  value={deleteConfirmationText}
                  onChange={(event) => setDeleteConfirmationText(event.target.value)}
                  placeholder={museum.name}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void deleteMuseum()}
                disabled={isDeletingMuseum || deleteConfirmationText.trim().length === 0}
                style={{
                  width: "fit-content",
                  borderColor: "color-mix(in srgb, var(--cp-danger) 35%, var(--cp-border))",
                  color: "var(--cp-danger)",
                }}
              >
                {isDeletingMuseum ? "正在永久删除…" : "永久删除整座博物馆"}
              </button>
            </div>
            {museumSetupStatus ? (
              <p className="empty-state-note" role="status">
                {museumSetupStatus}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="studio-overview" id="overview" aria-label="博物馆总览">
          <article className="studio-stat studio-stat--accent">
            <div>
              <span>馆藏作品</span>
              <strong>{artworks.length}</strong>
            </div>
            <Images size={24} aria-hidden="true" />
            <small>
              其中 {artworks.filter((item) => item.status === "published").length} 件正在展出
            </small>
          </article>
          <article className="studio-stat">
            <div>
              <span>线上展览</span>
              <strong>多场</strong>
            </div>
            <Archive size={24} aria-hidden="true" />
            <small>支持列表、草稿、归档与最新发布选择规则</small>
          </article>
          <article className="studio-stat">
            <div>
              <span>已发布作品</span>
              <strong>{artworks.filter((item) => item.status === "published").length}</strong>
            </div>
            <Users size={24} aria-hidden="true" />
            <small>草稿布展可先排练，发布时再严格校验内容完整性</small>
          </article>
        </section>

        <section className="studio-callout">
          <span className="callout-icon">
            <WandSparkles size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>可以开始正式策展了</strong>
            <p>给展览命名、拆分展室，再决定每件作品出现的顺序。</p>
          </div>
          <a href="#exhibitions">
            去布展
            <ChevronRight size={16} aria-hidden="true" />
          </a>
        </section>

        <section className="artwork-library" id="artworks">
          <div className="section-heading">
            <div>
              <p className="eyebrow">COLLECTION</p>
              <h2>作品库</h2>
            </div>
            <div className="filter-tabs" role="group" aria-label="筛选作品状态">
              {[
                ["all", "全部"],
                ["published", "已展出"],
                ["draft", "草稿"],
                ["archived", "已归档"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  className={activeFilter === value ? "is-active" : ""}
                  onClick={() =>
                    setActiveFilter(value as "all" | StudioArtwork["status"])
                  }
                  key={value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="studio-artwork-grid">
              <button
                type="button"
                className="add-artwork-card"
                onClick={() => setDialogOpen(true)}
                disabled={cloudEnabled && !museum}
              >
              <span>
                <ImagePlus size={26} aria-hidden="true" />
              </span>
              <strong>批量录入新作品</strong>
              <small>照片、裁切、音频与原话</small>
            </button>
            {visibleArtworks.map((artwork) => (
              <article className="studio-artwork-card" key={artwork.id}>
                <div className="studio-artwork-image">
                  {artwork.previewUrl ? (
                    <Image
                      src={artwork.previewUrl}
                      alt={artwork.title}
                      fill
                      sizes="(max-width: 680px) 50vw, (max-width: 1100px) 33vw, 25vw"
                      unoptimized
                    />
                  ) : artwork.visual ? (
                    <ArtworkVisual
                      visual={artwork.visual as VisualName}
                      title={artwork.title}
                    />
                  ) : null}
                  <span className={`status-pill status-pill--${artwork.status}`}>
                    {statusLabel[artwork.status]}
                  </span>
                  <button
                    type="button"
                    className="artwork-delete-button"
                    onClick={() => void deleteArtwork(artwork)}
                    aria-label={`删除作品：${artwork.title}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="studio-artwork-copy">
                  <strong>{artwork.title}</strong>
                  <span>
                    {artwork.age} · {artwork.medium}
                  </span>
                  <span>创作日期：{formatArtworkDate(artwork)}</span>
                  <span style={{ color: "var(--cp-text-muted)", fontSize: 10 }}>
                    来源版本 v{artwork.sourceVersion}
                    {artwork.audio?.status === "ready"
                      ? ` · 录音 ${Math.round(artwork.audio.durationSeconds ?? 0)} 秒`
                      : ""}
                  </span>
                  {artwork.childQuote ? (
                    <p>“{artwork.childQuote}”</p>
                  ) : (
                    <p className="is-empty">还没有记录兮爷原话</p>
                  )}
                  {artwork.tags.length > 0 ? (
                    <div className="suggestion-tags" style={{ marginTop: 8 }}>
                      {artwork.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ minHeight: 32, padding: "0 9px" }}
                      onClick={() => setEditingArtwork(artwork)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      编辑
                    </button>
                    <label
                      style={{
                        display: "grid",
                        gap: 3,
                        color: "var(--cp-text-muted)",
                        fontSize: 9,
                      }}
                    >
                      状态
                      <select
                        value={artwork.status}
                        onChange={(event) => {
                          const status = event.target
                            .value as StudioArtwork["status"];
                          void updateArtwork(artwork, { status }).catch((error) =>
                            setSyncStatus(
                              error instanceof Error
                                ? error.message
                                : "作品状态修改失败。",
                            ),
                          );
                        }}
                      >
                        <option value="draft">草稿</option>
                        <option value="published">已发布</option>
                        <option value="archived">已归档</option>
                      </select>
                    </label>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="studio-bottom-grid">
          <StudioExhibitionsPanel
            artworks={artworks}
            cloudEnabled={cloudEnabled}
            artworksLoadState={artworksLoadState}
          />

          <article id="family" className="studio-panel">
            <div className="panel-heading">
              <span className="panel-icon">
                <LockKeyhole size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>家庭访问</strong>
                <small className="panel-status panel-status--published">私密模式</small>
              </div>
            </div>
            <h3>
              {cloudEnabled
                ? `${invitations.reduce(
                    (count, invitation) =>
                      count + invitation.activeVisitorSessionCount,
                    0,
                  )} 个有效访客会话`
                : "本地预览未连接访客数据"}
            </h3>
            <p>
              {cloudEnabled
                ? formatLatestVisit(invitations)
                : "配置私密云端后，可创建和撤销家庭邀请。"}
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "end",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: 5,
                  color: "var(--cp-text-muted)",
                  fontSize: 10,
                }}
              >
                有效期
                <select
                  value={invitationDays}
                  onChange={(event) =>
                    setInvitationDays(Number(event.target.value) as 1 | 7 | 30)
                  }
                >
                  <option value={1}>1 天</option>
                  <option value={7}>7 天</option>
                  <option value={30}>30 天</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void createFamilyInvitation()}
                disabled={isCreatingInvitation || !cloudEnabled}
              >
                {isCreatingInvitation ? "正在创建…" : "创建邀请"}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
            {newInvitationUrl ? (
              <div
                style={{
                  display: "grid",
                  gap: 7,
                  marginTop: 14,
                  padding: 10,
                  border: "1px solid var(--cp-border)",
                  borderRadius: "0.625rem",
                }}
              >
                <label
                  style={{
                    display: "grid",
                    gap: 5,
                    color: "var(--cp-text-muted)",
                    fontSize: 10,
                  }}
                >
                  新邀请链接（仅本次显示）
                  <input
                    readOnly
                    value={newInvitationUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void copyInvitationUrl()}
                >
                  <Copy size={14} aria-hidden="true" />
                  复制链接
                </button>
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              {invitationsLoading ? (
                <p className="empty-state-note">正在读取邀请…</p>
              ) : invitations.length === 0 ? (
                <p className="empty-state-note">还没有创建过家庭邀请。</p>
              ) : (
                invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    style={{
                      display: "grid",
                      gap: 5,
                      padding: 10,
                      border: "1px solid var(--cp-border)",
                      borderRadius: "0.625rem",
                      background: "var(--cp-surface-soft)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <strong style={{ fontSize: 11 }}>{invitation.label}</strong>
                      <span style={{ color: "var(--cp-text-muted)", fontSize: 9 }}>
                        {invitationStatusLabel[invitation.status]}
                      </span>
                    </div>
                    <small style={{ color: "var(--cp-text-muted)" }}>
                      到期：{formatDateTime(invitation.expiresAt)} · 访问会话{" "}
                      {invitation.visitorSessionCount}
                    </small>
                    {invitation.status === "active" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ width: "max-content", minHeight: 30 }}
                        onClick={() => void revokeInvitation(invitation)}
                        disabled={revokingInvitationId === invitation.id}
                      >
                        {revokingInvitationId === invitation.id
                          ? "正在撤销…"
                          : "撤销邀请"}
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {invitationStatus ? (
              <p className="invitation-status" role="status">
                {invitationStatus}
              </p>
            ) : null}
          </article>
        </section>
      </div>

      {dialogOpen ? (
        <NewArtworkDialog
          onClose={() => setDialogOpen(false)}
          onCreate={addArtwork}
        />
      ) : null}
      {editingArtwork ? (
        <EditArtworkDialog
          artwork={editingArtwork}
          cloudEnabled={cloudEnabled}
          onClose={() => setEditingArtwork(null)}
          onRefresh={async () => {
            await refreshCloudArtworks();
          }}
          onSave={async (updates) => {
            await updateArtwork(editingArtwork, updates);
            setEditingArtwork(null);
          }}
        />
      ) : null}
    </main>
  );
}
