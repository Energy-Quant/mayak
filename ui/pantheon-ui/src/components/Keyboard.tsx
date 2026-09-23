// Keyboard — вкладка «Клавиатура»: хоткеи появятся позже.
// Данных о горячих клавишах в конфигах goose нет — таблицу не рисуем, пока она не появится.
import { Icon } from "./Icon";

export default function Keyboard() {
  return (
    <div className="card">
      <div className="empty">
        <div style={{ marginBottom: 12 }}>
          <Icon name="settings" size={40} />
        </div>
        <div className="card-title">Клавиатура</div>
        <div className="dim" style={{ marginTop: 6 }}>
          Настройка горячих клавиш — позже.
        </div>
        <div className="dim small" style={{ marginTop: 6 }}>
          В конфигурации goose пока нет данных о хоткеях
        </div>
      </div>
    </div>
  );
}
