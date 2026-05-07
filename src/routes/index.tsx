import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Settings, Loader2, QrCode, CheckCircle2, XCircle, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export const Route = createFileRoute("/")({
  component: Panel,
  head: () => ({
    meta: [
      { title: "Painel Evolution API - Conectar WhatsApp via QR Code" },
      {
        name: "description",
        content:
          "Painel para conectar instâncias da Evolution API via QR Code com atualização automática.",
      },
    ],
  }),
});

const DEFAULT_URL = "https://evolution-evolution.yh11mi.easypanel.host";

type EvoSettings = { url: string; apiKey: string };

function trimUrl(u: string) {
  return u.replace(/\/+$/, "");
}

async function evoFetch(
  settings: EvoSettings,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (settings.apiKey) headers.set("apikey", settings.apiKey);
  return fetch(`${trimUrl(settings.url)}${path}`, { ...init, headers });
}

function Panel() {
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<EvoSettings>({ url: DEFAULT_URL, apiKey: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<EvoSettings>({ url: DEFAULT_URL, apiKey: "" });
  const [savingSettings, setSavingSettings] = useState(false);

  const [instanceName, setInstanceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "connected">("idle");
  const [activeInstance, setActiveInstance] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<string>("");

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth state
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load settings from Supabase (public read)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("evolution_settings")
        .select("url, api_key")
        .maybeSingle();
      if (data) {
        const next = { url: data.url || DEFAULT_URL, apiKey: data.api_key || "" };
        setSettings(next);
        setDraft(next);
      }
    })();
  }, []);

  const stopTimers = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    refreshTimer.current = null;
    tickTimer.current = null;
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const renderQr = async (raw: string) => {
    const data = raw.startsWith("data:image")
      ? raw
      : await QRCode.toDataURL(raw, {
          width: 320,
          margin: 1,
          color: { dark: "#0a0a0a", light: "#ffffff" },
        });
    setQrDataUrl(data);
  };

  const persistInstance = async (name: string, phone?: string | null) => {
    try {
      await supabase
        .from("instances")
        .upsert({ name, phone: phone ?? null }, { onConflict: "name" });
    } catch (e) {
      console.error("persistInstance", e);
    }
  };

  const fetchInstancePhone = async (name: string, s: EvoSettings): Promise<string | null> => {
    try {
      const res = await evoFetch(
        s,
        `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`,
      );
      if (!res.ok) return null;
      const json = await res.json();
      const arr = Array.isArray(json) ? json : [json];
      for (const item of arr) {
        const inst = item?.instance ?? item;
        const phone =
          inst?.owner ||
          inst?.number ||
          inst?.wuid ||
          inst?.profilePictureUrl?.match?.(/\d+/)?.[0] ||
          null;
        if (phone) return String(phone).split("@")[0];
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchQr = useCallback(
    async (
      name: string,
      currentSettings: EvoSettings,
    ): Promise<"ok" | "missing" | "connected" | "error"> => {
      try {
        const res = await evoFetch(currentSettings, `/instance/connect/${encodeURIComponent(name)}`);
        if (res.status === 404) return "missing";
        if (!res.ok) {
          console.error("connect error", res.status, await res.text());
          return "error";
        }
        const json = await res.json();
        const base64 = json.base64 || json?.qrcode?.base64;
        const code = json.code || json?.qrcode?.code;
        if (!base64 && !code) return "connected";
        await renderQr(base64 || code);
        return "ok";
      } catch (e) {
        console.error(e);
        return "error";
      }
    },
    [],
  );

  const onConnected = async (name: string, s: EvoSettings) => {
    const phone = await fetchInstancePhone(name, s);
    await persistInstance(name, phone);
  };

  const startSession = useCallback(
    async (name: string, currentSettings: EvoSettings) => {
      stopTimers();
      setActiveInstance(name);
      setStatus("waiting");
      setCountdown(60);
      setQrDataUrl(null);

      const result = await fetchQr(name, currentSettings);
      if (result === "missing") {
        setStatus("idle");
        setActiveInstance(null);
        setPendingCreate(name);
        setCreateOpen(true);
        return;
      }
      if (result === "connected") {
        setStatus("connected");
        await onConnected(name, currentSettings);
        return;
      }
      if (result === "error") {
        setStatus("idle");
        setActiveInstance(null);
        toast.error("Erro ao buscar QR Code. Verifique a URL e a API Key.");
        return;
      }

      await persistInstance(name);

      tickTimer.current = setInterval(() => {
        setCountdown((c) => (c <= 1 ? 60 : c - 1));
      }, 1000);

      refreshTimer.current = setInterval(async () => {
        const r = await fetchQr(name, currentSettings);
        if (r === "connected") {
          setStatus("connected");
          stopTimers();
          await onConnected(name, currentSettings);
        }
        setCountdown(60);
      }, 60000);
    },
    [fetchQr, stopTimers],
  );

  const handleGenerate = async () => {
    const name = instanceName.trim();
    if (!name) return toast.error("Informe o nome da instância.");
    setLoading(true);
    await startSession(name, settings);
    setLoading(false);
  };

  const handleCreateInstance = async () => {
    const name = pendingCreate;
    setCreateOpen(false);
    setLoading(true);
    try {
      const res = await evoFetch(settings, "/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName: name,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });
      if (!res.ok) {
        toast.error(`Falha ao criar instância: ${res.status} ${await res.text()}`);
        setLoading(false);
        return;
      }
      const json = await res.json();
      const base64 = json?.qrcode?.base64 || json?.qr?.base64;
      const code = json?.qrcode?.code || json?.qr?.code;
      stopTimers();
      setActiveInstance(name);
      setStatus("waiting");
      setCountdown(60);
      await persistInstance(name);
      if (base64 || code) {
        await renderQr(base64 || code);
        tickTimer.current = setInterval(() => {
          setCountdown((c) => (c <= 1 ? 60 : c - 1));
        }, 1000);
        refreshTimer.current = setInterval(async () => {
          const r = await fetchQr(name, settings);
          if (r === "connected") {
            setStatus("connected");
            stopTimers();
            await onConnected(name, settings);
          }
          setCountdown(60);
        }, 60000);
      } else {
        await startSession(name, settings);
      }
      toast.success("Instância criada.");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar instância.");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!session) {
      toast.error("Faça login para salvar configurações.");
      return;
    }
    setSavingSettings(true);
    const next = { url: trimUrl(draft.url || DEFAULT_URL), apiKey: draft.apiKey.trim() };
    const { error } = await supabase
      .from("evolution_settings")
      .upsert(
        { id: true, url: next.url, api_key: next.apiKey },
        { onConflict: "id" },
      );
    setSavingSettings(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    setSettings(next);
    setSettingsOpen(false);
    toast.success("Configurações salvas.");
  };

  const openSettings = () => {
    if (!session) {
      toast.error("Faça login para acessar configurações.");
      return;
    }
    setDraft(settings);
    setSettingsOpen(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada.");
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <QrCode className="h-4 w-4" />
            </div>
            <h1 className="text-base font-semibold tracking-tight">Evolution Connect</h1>
          </div>
          <div className="flex items-center gap-1">
            {session ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Configurações"
                  onClick={openSettings}
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Sair" onClick={handleLogout}>
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                </Button>
              </>
            ) : (
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth">
                  <LogIn className="mr-2 h-4 w-4" /> Entrar
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold tracking-tight">Conectar WhatsApp</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe o nome da instância e gere o QR Code. Ele será atualizado automaticamente a cada 60 segundos.
          </p>
        </div>

        <Card className="p-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Nome da instância"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerate();
              }}
              disabled={loading}
            />
            <Button onClick={handleGenerate} disabled={loading} className="sm:w-44">
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <QrCode className="mr-2 h-4 w-4" />
              )}
              Gerar QR Code
            </Button>
          </div>

          {(status !== "idle" || qrDataUrl) && (
            <div className="mt-8 flex flex-col items-center gap-4">
              {status === "connected" ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <CheckCircle2 className="h-14 w-14 text-emerald-500" />
                  <p className="text-lg font-medium">Conectado com sucesso</p>
                  <p className="text-sm text-muted-foreground">
                    Instância <span className="font-mono">{activeInstance}</span> está ativa.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-white p-4">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="QR Code para conectar à Evolution API"
                        className="h-72 w-72"
                      />
                    ) : (
                      <div className="flex h-72 w-72 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">
                      Instância:{" "}
                      <span className="font-mono text-foreground">{activeInstance}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Próxima atualização em {countdown}s
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho e escaneie o código.
        </p>
      </main>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurações</DialogTitle>
            <DialogDescription>
              Defina a URL da Evolution API e sua API Key. Salvas no Supabase.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="evo-url">URL da Evolution API</Label>
              <Input
                id="evo-url"
                placeholder="https://..."
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evo-key">API Key</Label>
              <Input
                id="evo-key"
                type="password"
                placeholder="apikey"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instância não existe</DialogTitle>
            <DialogDescription>
              A instância <span className="font-mono">{pendingCreate}</span> não foi encontrada na
              Evolution API. Deseja criá-la agora?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              <XCircle className="mr-2 h-4 w-4" />
              Cancelar
            </Button>
            <Button onClick={handleCreateInstance}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
