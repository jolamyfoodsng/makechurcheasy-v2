export type PresentationFeature = {
  id: string;
  label: string;
  title: string;
  copy: string;
  image?: string;
  alt: string;
  note: string;
  highlights: string[];
  steps: { title: string; copy: string }[];
  questions: { q: string; a: string }[];
};

export const presentationFeatures: PresentationFeature[] = [
  {
    id: "bible", label: "Bible", title: "The right verse.\nRight on time.",
    copy: "Search and present Bible verses inside OBS Studio. Explore 1,000+ Bible versions in 250+ languages, compare passages and translations side by side, and update scripture on screen in real time without leaving the dock.",
    image: "bible", alt: "MakeChurchEazy Bible dock with John 3:16 selected", note: "Search a reference. Select a verse. Present it.",
    highlights: ["1,000+ Bible versions in 250+ languages", "Verse and translation comparison", "Real-time scripture updates", "Full screen or lower third"],
    steps: [
      { title: "Find the passage", copy: "Enter a Bible reference in the search field, or move through the chapter to choose your verse." },
      { title: "Choose how it appears", copy: "Select your Bible version, theme and text size. Use a full screen presentation or a lower third over your video." },
      { title: "Follow the message", copy: "Present the selected verse and update it in real time as the preacher continues. On paid plans, MakeChurchEazy creates and updates the required OBS scenes and sources automatically." },
    ],
    questions: [
      { q: "Can I compare different Bible passages?", a: "Yes. Use the Bible dock to compare passages as well as the same passage in different translations, without leaving OBS Studio." },
      { q: "Can I compare Bible translations?", a: "Yes. Use Compare Translations in the Bible output controls to prepare a comparison using the available versions." },
      { q: "Can scripture appear over our camera feed?", a: "Choose the lower-third output to place scripture over your video. Full screen is available when you want the passage to fill the presentation." },
      { q: "Can I use downloaded Bibles offline?", a: "Downloaded Bible content can be used for local presentation after setup. Sign-in, additional downloads and cloud services need an internet connection. Download limits vary by plan." },
    ],
  },
  {
    id: "worship", label: "Worship", title: "Keep every voice\non the same verse.",
    copy: "Prepare and present worship lyrics from the same workflow. Keep your songs together, arrange the slides, and follow the service with confidence.",
    image: "worship", alt: "MakeChurchEazy worship library with songs and prepared lyric slides", note: "Your song library, ready for Sunday.",
    highlights: ["Song library", "Prepared lyric slides", "Full screen or lower third"],
    steps: [
      { title: "Prepare your songs", copy: "Add songs to your worship library and check the lyrics before the service begins." },
      { title: "Arrange the lyrics", copy: "Work with the song’s sections and slides so the words are ready in a clear, readable format." },
      { title: "Follow the worship team", copy: "Select the lyric slide you need as the song moves between verses and choruses, from the same workspace as your other presentation tools." },
    ],
    questions: [
      { q: "Can we prepare lyrics before the service?", a: "Yes. Keep songs in the worship library and prepare their lyric slides ahead of time, so the operator can focus on the service." },
      { q: "Do lyrics have to fill the screen?", a: "You can choose a full screen presentation or a lower third to keep the video visible behind the lyrics." },
      { q: "Can I switch back to Bible presentation?", a: "Yes. Bible and Worship are part of the same Dock, so you can move between scripture and songs without opening another presentation application." },
    ],
  },
  {
    id: "lower-thirds", label: "Lower thirds", title: "Give every speaker\na proper introduction.",
    copy: "Display pastors, speakers, titles and announcements. Choose a theme, add the details, and bring a polished lower third into your OBS output.",
    image: "lower-thirds", alt: "MakeChurchEazy speaker lower-third controls and theme selection", note: "Speaker names, titles, and announcements.",
    highlights: ["Speaker names and titles", "Theme selection", "On-screen introductions"],
    steps: [
      { title: "Add the details", copy: "Enter the speaker’s name and title, or the announcement you want your viewers to see." },
      { title: "Choose a theme", copy: "Select a lower-third design and review how your text fits before displaying it." },
      { title: "Introduce the moment", copy: "Show the lower third when the speaker begins, then clear it when the introduction is complete." },
    ],
    questions: [
      { q: "What can I put in a lower third?", a: "Use it for a pastor or guest speaker’s name and title, or for a short announcement during your broadcast." },
      { q: "Can I change the design?", a: "Yes. Choose from the lower-third themes available to your plan and adjust the supported settings in the editor." },
      { q: "Will the camera remain visible?", a: "Lower thirds are designed to sit over your video, keeping the speaker visible while adding useful information." },
    ],
  },
  {
    id: "media", label: "Media", title: "Everything you want\nthe church to see.",
    copy: "Show church graphics and media quickly. Keep your service artwork, images, and videos in one place, ready to send into OBS.",
    image: "media", alt: "MakeChurchEazy media library with church graphics and videos", note: "Service graphics. Backgrounds. Images. Videos.",
    highlights: ["Image and video library", "Service graphics", "OBS presentation"],
    steps: [
      { title: "Bring your media together", copy: "Add the images, videos and service artwork your team plans to use." },
      { title: "Find the right item", copy: "Browse your media library and select the graphic or clip for the next part of the service." },
      { title: "Put it on screen", copy: "Present your chosen media from the Dock and return to scripture, worship or another tool when you need it." },
    ],
    questions: [
      { q: "Can we use our own church artwork?", a: "Yes. Add your church’s graphics and supported media to your library for use during services." },
      { q: "Does the library support videos?", a: "Yes. The Media tools support both images and videos. Check that your files play correctly during your pre-service rehearsal." },
      { q: "Do I need a separate media presentation app?", a: "Media is part of MakeChurchEazy’s OBS workflow alongside Bible, Worship and the other presentation tools." },
    ],
  },
  {
    id: "countdowns", label: "Tickers & countdowns", title: "Set the pace\nfor your service.",
    copy: "Handle announcements, information and service countdowns. Keep the team on time and the congregation informed.",
    image: "countdowns", alt: "MakeChurchEazy countdown timer dock inside OBS Studio with pre-service clock", note: "A clear start for every part of the service.",
    highlights: ["Service countdowns", "Timers and clocks", "Announcement tickers"],
    steps: [
      { title: "Choose your timing", copy: "Set up a countdown for the start of the service, or choose the timer or clock you need." },
      { title: "Add useful information", copy: "Prepare a ticker with a short welcome, announcement or message for viewers." },
      { title: "Keep the service moving", copy: "Use the Dock’s controls to manage the countdown and on-screen information as your service progresses." },
    ],
    questions: [
      { q: "Can I show a countdown before the service?", a: "Yes. Prepare a service countdown and display it in your presentation output before the service starts." },
      { q: "What is a ticker useful for?", a: "A ticker keeps a short message moving across the screen. Use it for welcome information, announcements or other service details." },
      { q: "Are clocks and timers included?", a: "The Dock includes countdown, timer and clock tools. Visit the plans page to check current feature availability." },
    ],
  },
  {
    id: "multiview", label: "Multi-view", title: "More on screen.\nAll working together.",
    copy: "Manage different presentation outputs more easily. Choose a layout and bring your OBS scenes, scripture, media, and overlays together.",
    image: "multiview", alt: "MakeChurchEazy multi-view split layout dock inside OBS Studio with scripture and camera presentation", note: "Choose the arrangement. Add your content.",
    highlights: ["Layout library", "Split screen", "Picture in picture"],
    steps: [
      { title: "Choose the arrangement", copy: "Browse the available layouts and choose how you want your content to share the screen." },
      { title: "Add your sources", copy: "Assign the scenes or content you need to the layout, then review the composition in OBS." },
      { title: "Present the full picture", copy: "Use the prepared view during your service when you want multiple pieces of content visible together." },
    ],
    questions: [
      { q: "What layouts are available?", a: "The layout library includes arrangements such as split screen and picture in picture. Available options may vary by plan." },
      { q: "Can I use my existing OBS scenes?", a: "Multi-view works with OBS scenes and sources, so you can build a composition around the content already in your production workflow." },
      { q: "Should I check the layout before going live?", a: "Yes. Preview the layout and its sources in OBS before using it in a live service." },
    ],
  },
  {
    id: "voice-bible", label: "Verse AI", title: "Speak it.\nShow it.",
    copy: "Connect a microphone or OBS audio input. Verse AI listens for spoken Bible references and suggests the passage so your operator can review it, choose a translation, and prepare it for presentation from inside OBS. Speech recognition and AI features require internet access and depend on your plan and credits.",
    alt: "Illustration of a spoken Bible reference becoming a scripture suggestion", note: "Find spoken references, review scripture suggestions, and keep the operator in control of what appears on screen.",
    highlights: ["Spoken references", "Scripture suggestions", "Review and present"],
    steps: [
      { title: "Connect your audio", copy: "Choose the audio input for the speech tools and check that the preacher’s voice can be heard clearly." },
      { title: "Follow the reference", copy: "When a Bible reference is spoken, use the scripture suggestions to locate the passage more quickly." },
      { title: "Review and present", copy: "Check the suggested passage and choose what to show. Keep your operator in control of what reaches the screen." },
    ],
    questions: [
      { q: "Do the speech tools need internet access?", a: "Yes. Speech and AI services require an internet connection and are subject to your plan and available credits." },
      { q: "Can I review the scripture first?", a: "Yes. Review the reference and passage before presenting it. Automatic queue and suggestion behavior can be configured in the app." },
      { q: "Will it recognize every reference perfectly?", a: "Recognition depends on audio quality and spoken context. Use a clear audio input and have an operator review suggestions during the service." },
    ],
  },
];

export function getPresentationFeature(id: string) {
  return presentationFeatures.find(feature => feature.id === id);
}
