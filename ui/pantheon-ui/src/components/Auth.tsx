// Auth — вкладка «Авторизация»: управление ключами появится позже.
// Значения API-ключей UI принципиально не показывает — goose хранит их в системном брелоке.
import { Icon } from "./Icon";

export default function Auth() {
  return (
    <div className="card">
      <div className="empty">
        <div style={{ marginBottom: 12 }}>
          <Icon name="app" size={40} />
        </div>
        <div className="card-title">Авторизация</div>
        <div className="dim" style={{ marginTop: 6 }}>
          Управление ключами провайдеров — позже.
        </div>
        <div className="dim small" style={{ marginTop: 6 }}>
          Ключи хранятся в системном брелоке, значения UI не раскрывает
        </div>
      </div>
    </div>
  );
}
