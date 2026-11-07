/**
 * ScriptureArchGalleryCard — a card in the Multi-View Layouts gallery. "Edit" opens the in-app
 * editor (ScriptureArchEditor); nothing is asked of OBS until the user sends it there. Mirrors
 * ScriptureCircleGalleryCard.tsx.
 */

import Icon from "../components/Icon";
import { loadScriptureArchSettings } from "../multiview/scriptureArchLook";
import ScriptureArchPreview from "./ScriptureArchPreview";
import "./ScriptureCircleEditor.css";

export default function ScriptureArchGalleryCard({ onEdit }: { onEdit: () => void }) {
  const settings = loadScriptureArchSettings();
  return (
    <div className="mvg-card">
      <div className="mvg-card-preview">
        <ScriptureArchPreview settings={settings} placeholder="Camera" />
        <span className="mvg-card-slots">Camera + Scripture</span>
      </div>
      <div className="mvg-card-info">
        <h3 className="mvg-card-name">Scripture Arch</h3>
        <p className="mvg-card-desc">Your camera in an arch window beside the verse you click in the Bible tab.</p>
        <div className="mvg-card-usecases">
          <span className="mvg-card-usecase">scripture</span>
          <span className="mvg-card-usecase">camera</span>
        </div>
      </div>
      <div className="mvg-card-actions">
        <button className="mvg-btn mvg-btn--sm mvg-btn--primary" onClick={onEdit} title="Edit Scripture Arch">
          <Icon name="edit" size={14} /> Edit
        </button>
      </div>
    </div>
  );
}
