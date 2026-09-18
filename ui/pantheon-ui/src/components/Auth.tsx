// Auth — вкладка Авторизация: провайдеры goose и место хранения ключей
import { useEffect, useState } from "react";
import { getConfigSummary } from "../api";

export default function Auth() {
  const [providers, setProviders] = useState<string[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getConfigSummary().then((c) => setProviders(c.providers ?? [])).catch((e) => setErr(String(e).slice(0, 100)));
  }, []);

  return (
    <div className="page">
      <h2>Авторизация</h2>
      <div className="page-hint">API-ключи goose хранит в системном брелоке (Secret Service / keyring). С undermine отображаются только имена провайдеров — значения ключей UI не раскрывает (безопасность).</div>
      {err && <div className="error-banner">⚠ {err}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Провайдер</th><th>Ключ</th></tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p}>
                <td>{p}</td>
                <td className="dim">в keyring (secret-service, schema goose)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="empty">Управление ключами — через оригинальный goose (CLI `goose configure`) или keyring утилиты.</div>
    </div>
  );
}
