/**
 * ScriptureGoldCircleGalleryCard — a card in the Multi-View Layouts gallery. "Edit" opens the
 * in-app editor (ScriptureGoldCircleEditor); nothing is asked of OBS until the user sends it
 * there. Mirrors ScriptureCircleGalleryCard.tsx.
 */

import Icon from "../components/Icon";
import { loadScriptureGoldCircleSettings } from "../multiview/scriptureGoldCircleLook";
import ScriptureGoldCirclePreview from "./ScriptureGoldCirclePreview";
import "./ScriptureCircleEditor.css";

export default function ScriptureGoldCircleGalleryCard({ onEdit }: { onEdit: () => void }) {
  const settings = loadScriptureGoldCircleSettings();
  return (
    <div className="mvg-card">
      <div className="mvg-card-preview">
        <ScriptureGoldCirclePreview settings={settings} placeholder="Camera" />
        <span className="mvg-card-slots">Camera + Scripture</span>
      </div>
      <div className="mvg-card-info">
        <h3 className="mvg-card-name">Scripture Gold Circle</h3>
        <p className="mvg-card-desc">A dark, gold-ringed circle for your camera beside the verse you click in the Bible tab.</p>
        <div className="mvg-card-usecases">
          <span className="mvg-card-usecase">scripture</span>
          <span className="mvg-card-usecase">camera</span>
        </div>
      </div>
      <div className="mvg-card-actions">
        <button className="mvg-btn mvg-btn--sm mvg-btn--primary" onClick={onEdit} title="Edit Scripture Gold Circle">
          <Icon name="edit" size={14} /> Edit
        </button>
      </div>
    </div>
  );
}
