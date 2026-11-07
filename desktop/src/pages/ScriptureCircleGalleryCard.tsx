/**
 * ScriptureCircleGalleryCard — the first card in the Multi-View Layouts gallery. "Edit" opens the
 * in-app editor (ScriptureCircleEditor); nothing is asked of OBS until the user sends it there.
 */

import Icon from "../components/Icon";
import { loadScriptureCircleSettings } from "../multiview/scriptureCircleLook";
import ScriptureCirclePreview from "./ScriptureCirclePreview";
import "./ScriptureCircleEditor.css";

export default function ScriptureCircleGalleryCard({ onEdit }: { onEdit: () => void }) {
  const settings = loadScriptureCircleSettings();
  return (
    <div className="mvg-card">
      <div className="mvg-card-preview">
        <ScriptureCirclePreview settings={settings} placeholder="Camera" />
        <span className="mvg-card-slots">Camera + Scripture</span>
      </div>
      <div className="mvg-card-info">
        <h3 className="mvg-card-name">Scripture Circle</h3>
        <p className="mvg-card-desc">Your camera in a round window, with the verse you click in the Bible tab beside it.</p>
        <div className="mvg-card-usecases">
          <span className="mvg-card-usecase">scripture</span>
          <span className="mvg-card-usecase">camera</span>
        </div>
      </div>
      <div className="mvg-card-actions">
        <button className="mvg-btn mvg-btn--sm mvg-btn--primary" onClick={onEdit} title="Edit Scripture Circle">
          <Icon name="edit" size={14} /> Edit
        </button>
      </div>
    </div>
  );
}
