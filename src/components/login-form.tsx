"use client";

import { ArrowLeft, KeyRound, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type LoginFormProps = {
  configured: boolean;
};

export function LoginForm({ configured }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configured) {
      setError("Supabase 尚未配置，本地预览可直接进入馆长台。");
      return;
    }

    setIsSending(true);
    setMessage("");
    setError("");
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) {
        throw authError;
      }
      setMessage("登录链接已发送，请查看邮箱。");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "登录邮件发送失败。",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="login-shell">
      <Link href="/" className="login-back">
        <ArrowLeft size={17} aria-hidden="true" />
        返回博物馆
      </Link>
      <section className="login-card">
        <span className="brand-seal">兮</span>
        <p className="eyebrow">CURATOR ACCESS</p>
        <h1>馆长登录</h1>
        <p className="login-intro">
          只有馆长可以录入作品、审核 AI 建议和管理家人邀请。
        </p>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>邮箱</span>
            <span className="login-input">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
                autoComplete="email"
              />
            </span>
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={isSending}
          >
            <KeyRound size={17} aria-hidden="true" />
            {isSending ? "正在发送…" : "发送免密码登录链接"}
          </button>
        </form>
        {message ? <p className="login-message">{message}</p> : null}
        {error ? <p className="login-error">{error}</p> : null}
        {!configured ? (
          <Link href="/studio" className="demo-access">
            本地预览：直接进入馆长台
          </Link>
        ) : null}
        <div className="login-privacy">
          <LockKeyhole size={16} aria-hidden="true" />
          登录链接仅在短时间内有效，无需设置或保存密码。
        </div>
      </section>
    </main>
  );
}
