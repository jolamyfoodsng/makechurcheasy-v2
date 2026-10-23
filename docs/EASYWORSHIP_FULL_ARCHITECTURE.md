# EasyWorship Full Storage & Media Architecture Note

This document serves as the technical reference for EasyWorship 6 & 7 media, theme, schedule, and song storage architecture for **MakeChurchEazy**.

---

## 1. Song Storage Architecture

EasyWorship splits song metadata and slide lyrics across two SQLite databases in the profile data folder:
`C:\Users\Public\Documents\Softouch\Easyworship\Default\<version>\Databases\Data\`

* **`Songs.db`** (Metadata): Contains `song` table (`rowid`, `title`, `author`, `copyright`, `administrator`, `reference_number`, `tags`).
* **`SongWords.db`** (Lyrics & Slides): Contains `word` table (`rowid`, `song_id` foreign key referencing `song.rowid`, `words` stored as Rich Text Format `{\rtf1...}`).

---

## 2. Themes Architecture

Themes in EasyWorship are structured presentation layouts:
* **Theme Definitions**: Stored in `Databases\Data\Themes.db` and `PresentationLayouts.db`.
* **Theme Media Assets**: When a theme uses a video or image background, it points to the media record in `Media.db`, referencing media files stored in `Resources\Videos\` or `Resources\Images\`.
* **Exported Theme Files**: Themes exported or saved as standalone files are placed in `Resources\Themes\`.

---

## 3. Media Assets (Videos & Images) Architecture

Loose media assets are stored directly on the file system:
* **Videos**: `C:\Users\Public\Documents\Softouch\Easyworship\Default\Resources\Videos\`
* **Images**: `C:\Users\Public\Documents\Softouch\Easyworship\Default\Resources\Images\`
* **Media Metadata Database**: `Databases\Data\Media.db` (Contains titles, original filenames, aspect ratios, thumbnails, and media tags).

---

## 4. Schedules & Packages Architecture

* **Schedule Files (`.ewsx`)**:
  * Stored at: `C:\Users\Public\Documents\Softouch\Easyworship\Default\Resources\Schedules\`
  * Container: ZIP-compressed archive container holding JSON/XML schedule definitions, embedded presentation slides, user songs, and associated background media assets (`.mp4`, `.jpg`).
* **Song Packages (`.ewpck`)**:
  * Packaged content items used to export or import collections of songs between EasyWorship profiles and machines.

---

## 5. MakeChurchEazy Import Capabilities

1. **Songs Import** (`read_easyworship_db_folder`, `easyWorshipImportService.ts`): `Songs.db` + `SongWords.db`, with the RTF decoded (font/colour tables skipped, `\'xx` and `\uN` characters decoded) and split into sections (`Verse 1`, `Chorus`, `Bridge`).
2. **Media Library Import** (`read_easyworship_assets`, `easyWorshipAssetImport.ts`): the files listed in `Media.db` plus anything else in `Resources\Images\` and `Resources\Videos\`, copied into the Media library with their EasyWorship titles.
3. **Theme Import**: each song theme (`presentation_type` 13) and scripture theme (14) becomes a fullscreen theme. The background is the `BACKGROUND` element's foreground resource (`resource_image` / `resource_video`, `<images>` / `<videos>` paths), or its solid colour (`resource_color`, stored as `0x00BBGGRR`). Theme videos also get an MP4 preview copy, because the app's previews can't play `.wmv`; OBS plays the original.
4. **Not imported yet**: schedules (`.ewsx`), presentations, and theme fonts and text positions.
