/**
 * tickerSpeed.ts — makes the Speed slider move pill / bottom tickers at a steady pixel speed.
 *
 * Those tickers scroll their text with a CSS animation whose length was a fixed number of
 * seconds. A short message is only a few hundred pixels wide, so even "Fast" (14 s per trip)
 * crawled, and the slider seemed to do nothing. The script below measures the text, repeats it
 * until it fills the bar, and sets the animation time to (distance / pixels per second), the
 * same way the Dock's other tickers (Fresh, Minimal, Glass) already work.
 * Without scripts (a script-free preview) the plain seconds in --speed are used as before.
 */

/** Pixels per second for a Speed slider value of 1-100. Same numbers as generateTickerHTML. */
export function tickerPixelsPerSecond(speed: number): number {
  const value = Number.isFinite(speed) ? speed : 50;
  return Math.max(60, Math.min(320, 40 + value * 2.8));
}

/** True when the ticker markup has a scrolling track this script can drive. */
export function hasTickerMove(html: string): boolean {
  return html.includes("ticker-move");
}

export function buildTickerSpeedScript(pixelsPerSecond: number): string {
  const pps = Math.round(pixelsPerSecond * 100) / 100;
  return `<script>(function(){var pps=${pps};
function fit(){var moves=document.querySelectorAll(".ticker-move");
for(var i=0;i<moves.length;i++){var m=moves[i];if(!m.__unit&&m.children[0])m.__unit=m.children[0].cloneNode(true);var unit=m.__unit;if(!unit)continue;
var track=m.parentNode,width=(track&&track.clientWidth)||window.innerWidth;
var build=function(k){m.innerHTML="";for(var j=0;j<k*2;j++)m.appendChild(unit.cloneNode(true))};
var gap=parseFloat(getComputedStyle(m).columnGap)||0;m.style.paddingRight=gap+"px";
var n=1;build(n);while(n<24&&m.scrollWidth/2<width){n++;build(n)}
var half=m.scrollWidth/2;if(half>0)m.style.animationDuration=Math.max(4,half/pps)+"s"}}
var timer;function later(){clearTimeout(timer);timer=setTimeout(fit,120)}
fit();window.addEventListener("resize",later);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(later)})();</script>`;
}
