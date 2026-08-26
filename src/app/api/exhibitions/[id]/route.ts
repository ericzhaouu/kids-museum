import { NextResponse } from "next/server";
import { z } from "zod";
import {
  archiveEditableExhibition,
  deleteEditableExhibition,
  listEditableExhibitions,
} from "@/lib/exhibitions/editor-server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ExhibitionRouteContext = {
  params: Promise<{ id: string }>;
};

const actionSchema = z.object({
  action: z.enum(["archive"]),
});

export async function PATCH(request: Request, context: ExhibitionRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "当前处于本地预览模式。" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "展览编号无效。" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "操作无效。" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    return NextResponse.json({
      exhibition: await archiveEditableExhibition(supabase, id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "展览归档失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: ExhibitionRouteContext) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "当前处于本地预览模式。" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "展览编号无效。" }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录馆长账号。" }, { status: 401 });
    }

    await deleteEditableExhibition(supabase, id);
    const { activeExhibitionId } = await listEditableExhibitions(supabase);
    return NextResponse.json({ deleted: true, activeExhibitionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "展览删除失败。";
    const status =
      message.includes("不存在或无权操作") || message.includes("请先归档") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
