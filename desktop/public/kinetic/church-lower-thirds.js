/*
 * Make Church Eazy — "Church graphics" lower thirds (11 animated graphics), registered into
 * the Motion engine (kinetic-lower-thirds.js must load first).
 *
 * Ported from the church-lower-thirds v1 + v2 test benches (this file is the source now; edit it
 * directly, then run scripts/generate-kinetic-themes.cjs if fields or names change). The
 * animations are the benches' GSAP timelines, unchanged in feel:
 *   IN  = structure first (bar / band / frame), then the title, then details left to right
 *   OUT = details leave first, then the title, then the structure retracts the way it came
 *
 * Each graphic is laid out on its original 1920x1080 frame. In OBS it is pinned to the screen
 * (full-width bands run edge to edge). Size scales it; Position moves it to the top or bottom,
 * and boxed graphics (Prayer, Join a Group, Blue Panel) also follow left / centre / right.
 * Text and colour fields are read from the theme's data-v-* attributes, so the Dock edits them.
 *
 * Includes "QR Code Generator for JavaScript", Copyright (c) 2009 Kazuhiko Arase, MIT licence
 * (http://www.opensource.org/licenses/mit-license.php). "QR Code" is a registered trademark
 * of DENSO WAVE INCORPORATED.
 */
(function (global) {
  "use strict";
  var api = global.MCEKinetic;
  if (!api || !api.register) return;
  var gsap = global.gsap;
  var QR = (function () { try { return (function(){var Y=(function(){var N=function(x,w){var g=236,l=17,n=x,s=O[w],t=null,r=0,h=null,i=[],v={},_=function(a,f){r=n*4+17,t=(function(e){for(var u=new Array(e),o=0;o<e;o+=1){u[o]=new Array(e);for(var d=0;d<e;d+=1)u[o][d]=null}return u})(r),B(0,0),B(r-7,0),B(0,r-7),E(),b(),m(a,f),n>=7&&I(a),h==null&&(h=ar(n,s,i)),U(h,f)},B=function(a,f){for(var e=-1;e<=7;e+=1)if(!(a+e<=-1||r<=a+e))for(var u=-1;u<=7;u+=1)f+u<=-1||r<=f+u||(0<=e&&e<=6&&(u==0||u==6)||0<=u&&u<=6&&(e==0||e==6)||2<=e&&e<=4&&2<=u&&u<=4?t[a+e][f+u]=!0:t[a+e][f+u]=!1)},y=function(){for(var a=0,f=0,e=0;e<8;e+=1){_(!0,e);var u=k.getLostPoint(v);(e==0||a>u)&&(a=u,f=e)}return f},b=function(){for(var a=8;a<r-8;a+=1)t[a][6]==null&&(t[a][6]=a%2==0);for(var f=8;f<r-8;f+=1)t[6][f]==null&&(t[6][f]=f%2==0)},E=function(){for(var a=k.getPatternPosition(n),f=0;f<a.length;f+=1)for(var e=0;e<a.length;e+=1){var u=a[f],o=a[e];if(t[u][o]==null)for(var d=-2;d<=2;d+=1)for(var c=-2;c<=2;c+=1)d==-2||d==2||c==-2||c==2||d==0&&c==0?t[u+d][o+c]=!0:t[u+d][o+c]=!1}},I=function(a){for(var f=k.getBCHTypeNumber(n),e=0;e<18;e+=1){var u=!a&&(f>>e&1)==1;t[Math.floor(e/3)][e%3+r-8-3]=u}for(var e=0;e<18;e+=1){var u=!a&&(f>>e&1)==1;t[e%3+r-8-3][Math.floor(e/3)]=u}},m=function(a,f){for(var e=s<<3|f,u=k.getBCHTypeInfo(e),o=0;o<15;o+=1){var d=!a&&(u>>o&1)==1;o<6?t[o][8]=d:o<8?t[o+1][8]=d:t[r-15+o][8]=d}for(var o=0;o<15;o+=1){var d=!a&&(u>>o&1)==1;o<8?t[8][r-o-1]=d:o<9?t[8][15-o-1+1]=d:t[8][15-o-1]=d}t[r-8][8]=!a},U=function(a,f){for(var e=-1,u=r-1,o=7,d=0,c=k.getMaskFunction(f),p=r-1;p>0;p-=2)for(p==6&&(p-=1);;){for(var T=0;T<2;T+=1)if(t[u][p-T]==null){var C=!1;d<a.length&&(C=(a[d]>>>o&1)==1);var A=c(u,p-T);A&&(C=!C),t[u][p-T]=C,o-=1,o==-1&&(d+=1,o=7)}if(u+=e,u<0||r<=u){u-=e,e=-e;break}}},H=function(a,f){for(var e=0,u=0,o=0,d=new Array(f.length),c=new Array(f.length),p=0;p<f.length;p+=1){var T=f[p].dataCount,C=f[p].totalCount-T;u=Math.max(u,T),o=Math.max(o,C),d[p]=new Array(T);for(var A=0;A<d[p].length;A+=1)d[p][A]=255&a.getBuffer()[A+e];e+=T;var P=k.getErrorCorrectPolynomial(C),R=K(d[p],P.getLength()-1),X=R.mod(P);c[p]=new Array(P.getLength()-1);for(var A=0;A<c[p].length;A+=1){var Z=A+X.getLength()-c[p].length;c[p][A]=Z>=0?X.getAt(Z):0}}for(var $=0,A=0;A<f.length;A+=1)$+=f[A].totalCount;for(var J=new Array($),Q=0,A=0;A<u;A+=1)for(var p=0;p<f.length;p+=1)A<d[p].length&&(J[Q]=d[p][A],Q+=1);for(var A=0;A<o;A+=1)for(var p=0;p<f.length;p+=1)A<c[p].length&&(J[Q]=c[p][A],Q+=1);return J},ar=function(a,f,e){for(var u=G.getRSBlocks(a,f),o=S(),d=0;d<e.length;d+=1){var c=e[d];o.put(c.getMode(),4),o.put(c.getLength(),k.getLengthInBits(c.getMode(),a)),c.write(o)}for(var p=0,d=0;d<u.length;d+=1)p+=u[d].dataCount;if(o.getLengthInBits()>p*8)throw"code length overflow. ("+o.getLengthInBits()+">"+p*8+")";for(o.getLengthInBits()+4<=p*8&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=p*8||(o.put(g,8),o.getLengthInBits()>=p*8));)o.put(l,8);return H(o,u)};v.addData=function(a,f){f=f||"Byte";var e=null;switch(f){case"Numeric":e=W(a);break;case"Alphanumeric":e=V(a);break;case"Byte":e=q(a);break;case"Kanji":e=z(a);break;default:throw"mode:"+f}i.push(e),h=null},v.isDark=function(a,f){if(a<0||r<=a||f<0||r<=f)throw a+","+f;return t[a][f]},v.getModuleCount=function(){return r},v.make=function(){if(n<1){for(var a=1;a<40;a++){for(var f=G.getRSBlocks(a,s),e=S(),u=0;u<i.length;u++){var o=i[u];e.put(o.getMode(),4),e.put(o.getLength(),k.getLengthInBits(o.getMode(),a)),o.write(e)}for(var d=0,u=0;u<f.length;u++)d+=f[u].dataCount;if(e.getLengthInBits()<=d*8)break}n=a}_(!1,y())},v.createTableTag=function(a,f){a=a||2,f=typeof f>"u"?a*4:f;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+f+"px;",e+='">',e+="<tbody>";for(var u=0;u<v.getModuleCount();u+=1){e+="<tr>";for(var o=0;o<v.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+a+"px;",e+=" height: "+a+"px;",e+=" background-color: ",e+=v.isDark(u,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>",e},v.createSvgTag=function(a,f,e,u){var o={};typeof arguments[0]=="object"&&(o=arguments[0],a=o.cellSize,f=o.margin,e=o.alt,u=o.title),a=a||2,f=typeof f>"u"?a*4:f,e=typeof e=="string"?{text:e}:e||{},e.text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,u=typeof u=="string"?{text:u}:u||{},u.text=u.text||null,u.id=u.text?u.id||"qrcode-title":null;var d=v.getModuleCount()*a+f*2,c,p,T,C,A="",P;for(P="l"+a+",0 0,"+a+" -"+a+",0 0,-"+a+"z ",A+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',A+=o.scalable?"":' width="'+d+'px" height="'+d+'px"',A+=' viewBox="0 0 '+d+" "+d+'" ',A+=' preserveAspectRatio="xMinYMin meet"',A+=u.text||e.text?' role="img" aria-labelledby="'+F([u.id,e.id].join(" ").trim())+'"':"",A+=">",A+=u.text?'<title id="'+F(u.id)+'">'+F(u.text)+"</title>":"",A+=e.text?'<description id="'+F(e.id)+'">'+F(e.text)+"</description>":"",A+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',A+='<path d="',T=0;T<v.getModuleCount();T+=1)for(C=T*a+f,c=0;c<v.getModuleCount();c+=1)v.isDark(T,c)&&(p=c*a+f,A+="M"+p+","+C+P);return A+='" stroke="transparent" fill="black"/>',A+="</svg>",A},v.createDataURL=function(a,f){a=a||2,f=typeof f>"u"?a*4:f;var e=v.getModuleCount()*a+f*2,u=f,o=e-f;return nr(e,e,function(d,c){if(u<=d&&d<o&&u<=c&&c<o){var p=Math.floor((d-u)/a),T=Math.floor((c-u)/a);return v.isDark(T,p)?0:1}else return 1})},v.createImgTag=function(a,f,e){a=a||2,f=typeof f>"u"?a*4:f;var u=v.getModuleCount()*a+f*2,o="";return o+="<img",o+=' src="',o+=v.createDataURL(a,f),o+='"',o+=' width="',o+=u,o+='"',o+=' height="',o+=u,o+='"',e&&(o+=' alt="',o+=F(e),o+='"'),o+="/>",o};var F=function(a){for(var f="",e=0;e<a.length;e+=1){var u=a.charAt(e);switch(u){case"<":f+="&lt;";break;case">":f+="&gt;";break;case"&":f+="&amp;";break;case'"':f+="&quot;";break;default:f+=u;break}}return f},fr=function(a){var f=1;a=typeof a>"u"?f*2:a;var e=v.getModuleCount()*f+a*2,u=a,o=e-a,d,c,p,T,C,A={"\u2588\u2588":"\u2588","\u2588 ":"\u2580"," \u2588":"\u2584","  ":" "},P={"\u2588\u2588":"\u2580","\u2588 ":"\u2580"," \u2588":" ","  ":" "},R="";for(d=0;d<e;d+=2){for(p=Math.floor((d-u)/f),T=Math.floor((d+1-u)/f),c=0;c<e;c+=1)C="\u2588",u<=c&&c<o&&u<=d&&d<o&&v.isDark(p,Math.floor((c-u)/f))&&(C=" "),u<=c&&c<o&&u<=d+1&&d+1<o&&v.isDark(T,Math.floor((c-u)/f))?C+=" ":C+="\u2588",R+=a<1&&d+1>=o?P[C]:A[C];R+=`
`}return e%2&&a>0?R.substring(0,R.length-e-1)+Array(e+1).join("\u2580"):R.substring(0,R.length-1)};return v.createASCII=function(a,f){if(a=a||1,a<2)return fr(f);a-=1,f=typeof f>"u"?a*2:f;var e=v.getModuleCount()*a+f*2,u=f,o=e-f,d,c,p,T,C=Array(a+1).join("\u2588\u2588"),A=Array(a+1).join("  "),P="",R="";for(d=0;d<e;d+=1){for(p=Math.floor((d-u)/a),R="",c=0;c<e;c+=1)T=1,u<=c&&c<o&&u<=d&&d<o&&v.isDark(p,Math.floor((c-u)/a))&&(T=0),R+=T?C:A;for(p=0;p<a;p+=1)P+=R+`
`}return P.substring(0,P.length-1)},v.renderTo2dContext=function(a,f){f=f||2;for(var e=v.getModuleCount(),u=0;u<e;u++)for(var o=0;o<e;o++)a.fillStyle=v.isDark(u,o)?"black":"white",a.fillRect(o*f,u*f,f,f)},v};N.stringToBytesFuncs={default:function(x){for(var w=[],g=0;g<x.length;g+=1){var l=x.charCodeAt(g);w.push(l&255)}return w}},N.stringToBytes=N.stringToBytesFuncs.default,N.createStringToBytes=function(x,w){var g=(function(){for(var n=tr(x),s=function(){var b=n.read();if(b==-1)throw"eof";return b},t=0,r={};;){var h=n.read();if(h==-1)break;var i=s(),v=s(),_=s(),B=String.fromCharCode(h<<8|i),y=v<<8|_;r[B]=y,t+=1}if(t!=w)throw t+" != "+w;return r})(),l=63;return function(n){for(var s=[],t=0;t<n.length;t+=1){var r=n.charCodeAt(t);if(r<128)s.push(r);else{var h=g[n.charAt(t)];typeof h=="number"?(h&255)==h?s.push(h):(s.push(h>>>8),s.push(h&255)):s.push(l)}}return s}};var D={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8},O={L:1,M:0,Q:3,H:2},L={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7},k=(function(){var x=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],w=1335,g=7973,l=21522,n={},s=function(t){for(var r=0;t!=0;)r+=1,t>>>=1;return r};return n.getBCHTypeInfo=function(t){for(var r=t<<10;s(r)-s(w)>=0;)r^=w<<s(r)-s(w);return(t<<10|r)^l},n.getBCHTypeNumber=function(t){for(var r=t<<12;s(r)-s(g)>=0;)r^=g<<s(r)-s(g);return t<<12|r},n.getPatternPosition=function(t){return x[t-1]},n.getMaskFunction=function(t){switch(t){case L.PATTERN000:return function(r,h){return(r+h)%2==0};case L.PATTERN001:return function(r,h){return r%2==0};case L.PATTERN010:return function(r,h){return h%3==0};case L.PATTERN011:return function(r,h){return(r+h)%3==0};case L.PATTERN100:return function(r,h){return(Math.floor(r/2)+Math.floor(h/3))%2==0};case L.PATTERN101:return function(r,h){return r*h%2+r*h%3==0};case L.PATTERN110:return function(r,h){return(r*h%2+r*h%3)%2==0};case L.PATTERN111:return function(r,h){return(r*h%3+(r+h)%2)%2==0};default:throw"bad maskPattern:"+t}},n.getErrorCorrectPolynomial=function(t){for(var r=K([1],0),h=0;h<t;h+=1)r=r.multiply(K([1,M.gexp(h)],0));return r},n.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case D.MODE_NUMBER:return 10;case D.MODE_ALPHA_NUM:return 9;case D.MODE_8BIT_BYTE:return 8;case D.MODE_KANJI:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case D.MODE_NUMBER:return 12;case D.MODE_ALPHA_NUM:return 11;case D.MODE_8BIT_BYTE:return 16;case D.MODE_KANJI:return 10;default:throw"mode:"+t}else if(r<41)switch(t){case D.MODE_NUMBER:return 14;case D.MODE_ALPHA_NUM:return 13;case D.MODE_8BIT_BYTE:return 16;case D.MODE_KANJI:return 12;default:throw"mode:"+t}else throw"type:"+r},n.getLostPoint=function(t){for(var r=t.getModuleCount(),h=0,i=0;i<r;i+=1)for(var v=0;v<r;v+=1){for(var _=0,B=t.isDark(i,v),y=-1;y<=1;y+=1)if(!(i+y<0||r<=i+y))for(var b=-1;b<=1;b+=1)v+b<0||r<=v+b||y==0&&b==0||B==t.isDark(i+y,v+b)&&(_+=1);_>5&&(h+=3+_-5)}for(var i=0;i<r-1;i+=1)for(var v=0;v<r-1;v+=1){var E=0;t.isDark(i,v)&&(E+=1),t.isDark(i+1,v)&&(E+=1),t.isDark(i,v+1)&&(E+=1),t.isDark(i+1,v+1)&&(E+=1),(E==0||E==4)&&(h+=3)}for(var i=0;i<r;i+=1)for(var v=0;v<r-6;v+=1)t.isDark(i,v)&&!t.isDark(i,v+1)&&t.isDark(i,v+2)&&t.isDark(i,v+3)&&t.isDark(i,v+4)&&!t.isDark(i,v+5)&&t.isDark(i,v+6)&&(h+=40);for(var v=0;v<r;v+=1)for(var i=0;i<r-6;i+=1)t.isDark(i,v)&&!t.isDark(i+1,v)&&t.isDark(i+2,v)&&t.isDark(i+3,v)&&t.isDark(i+4,v)&&!t.isDark(i+5,v)&&t.isDark(i+6,v)&&(h+=40);for(var I=0,v=0;v<r;v+=1)for(var i=0;i<r;i+=1)t.isDark(i,v)&&(I+=1);var m=Math.abs(100*I/r/r-50)/5;return h+=m*10,h},n})(),M=(function(){for(var x=new Array(256),w=new Array(256),g=0;g<8;g+=1)x[g]=1<<g;for(var g=8;g<256;g+=1)x[g]=x[g-4]^x[g-5]^x[g-6]^x[g-8];for(var g=0;g<255;g+=1)w[x[g]]=g;var l={};return l.glog=function(n){if(n<1)throw"glog("+n+")";return w[n]},l.gexp=function(n){for(;n<0;)n+=255;for(;n>=256;)n-=255;return x[n]},l})();function K(x,w){if(typeof x.length>"u")throw x.length+"/"+w;var g=(function(){for(var n=0;n<x.length&&x[n]==0;)n+=1;for(var s=new Array(x.length-n+w),t=0;t<x.length-n;t+=1)s[t]=x[t+n];return s})(),l={};return l.getAt=function(n){return g[n]},l.getLength=function(){return g.length},l.multiply=function(n){for(var s=new Array(l.getLength()+n.getLength()-1),t=0;t<l.getLength();t+=1)for(var r=0;r<n.getLength();r+=1)s[t+r]^=M.gexp(M.glog(l.getAt(t))+M.glog(n.getAt(r)));return K(s,0)},l.mod=function(n){if(l.getLength()-n.getLength()<0)return l;for(var s=M.glog(l.getAt(0))-M.glog(n.getAt(0)),t=new Array(l.getLength()),r=0;r<l.getLength();r+=1)t[r]=l.getAt(r);for(var r=0;r<n.getLength();r+=1)t[r]^=M.gexp(M.glog(n.getAt(r))+s);return K(t,0).mod(n)},l}var G=(function(){var x=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],w=function(n,s){var t={};return t.totalCount=n,t.dataCount=s,t},g={},l=function(n,s){switch(s){case O.L:return x[(n-1)*4+0];case O.M:return x[(n-1)*4+1];case O.Q:return x[(n-1)*4+2];case O.H:return x[(n-1)*4+3];default:return}};return g.getRSBlocks=function(n,s){var t=l(n,s);if(typeof t>"u")throw"bad rs block @ typeNumber:"+n+"/errorCorrectionLevel:"+s;for(var r=t.length/3,h=[],i=0;i<r;i+=1)for(var v=t[i*3+0],_=t[i*3+1],B=t[i*3+2],y=0;y<v;y+=1)h.push(w(_,B));return h},g})(),S=function(){var x=[],w=0,g={};return g.getBuffer=function(){return x},g.getAt=function(l){var n=Math.floor(l/8);return(x[n]>>>7-l%8&1)==1},g.put=function(l,n){for(var s=0;s<n;s+=1)g.putBit((l>>>n-s-1&1)==1)},g.getLengthInBits=function(){return w},g.putBit=function(l){var n=Math.floor(w/8);x.length<=n&&x.push(0),l&&(x[n]|=128>>>w%8),w+=1},g},W=function(x){var w=D.MODE_NUMBER,g=x,l={};l.getMode=function(){return w},l.getLength=function(t){return g.length},l.write=function(t){for(var r=g,h=0;h+2<r.length;)t.put(n(r.substring(h,h+3)),10),h+=3;h<r.length&&(r.length-h==1?t.put(n(r.substring(h,h+1)),4):r.length-h==2&&t.put(n(r.substring(h,h+2)),7))};var n=function(t){for(var r=0,h=0;h<t.length;h+=1)r=r*10+s(t.charAt(h));return r},s=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-48;throw"illegal char :"+t};return l},V=function(x){var w=D.MODE_ALPHA_NUM,g=x,l={};l.getMode=function(){return w},l.getLength=function(s){return g.length},l.write=function(s){for(var t=g,r=0;r+1<t.length;)s.put(n(t.charAt(r))*45+n(t.charAt(r+1)),11),r+=2;r<t.length&&s.put(n(t.charAt(r)),6)};var n=function(s){if("0"<=s&&s<="9")return s.charCodeAt(0)-48;if("A"<=s&&s<="Z")return s.charCodeAt(0)-65+10;switch(s){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+s}};return l},q=function(x){var w=D.MODE_8BIT_BYTE,g=x,l=N.stringToBytes(x),n={};return n.getMode=function(){return w},n.getLength=function(s){return l.length},n.write=function(s){for(var t=0;t<l.length;t+=1)s.put(l[t],8)},n},z=function(x){var w=D.MODE_KANJI,g=x,l=N.stringToBytesFuncs.SJIS;if(!l)throw"sjis not supported.";(function(t,r){var h=l(t);if(h.length!=2||(h[0]<<8|h[1])!=r)throw"sjis not supported."})("\u53CB",38726);var n=l(x),s={};return s.getMode=function(){return w},s.getLength=function(t){return~~(n.length/2)},s.write=function(t){for(var r=n,h=0;h+1<r.length;){var i=(255&r[h])<<8|255&r[h+1];if(33088<=i&&i<=40956)i-=33088;else if(57408<=i&&i<=60351)i-=49472;else throw"illegal char at "+(h+1)+"/"+i;i=(i>>>8&255)*192+(i&255),t.put(i,13),h+=2}if(h<r.length)throw"illegal char at "+(h+1)},s},j=function(){var x=[],w={};return w.writeByte=function(g){x.push(g&255)},w.writeShort=function(g){w.writeByte(g),w.writeByte(g>>>8)},w.writeBytes=function(g,l,n){l=l||0,n=n||g.length;for(var s=0;s<n;s+=1)w.writeByte(g[s+l])},w.writeString=function(g){for(var l=0;l<g.length;l+=1)w.writeByte(g.charCodeAt(l))},w.toByteArray=function(){return x},w.toString=function(){var g="";g+="[";for(var l=0;l<x.length;l+=1)l>0&&(g+=","),g+=x[l];return g+="]",g},w},rr=function(){var x=0,w=0,g=0,l="",n={},s=function(r){l+=String.fromCharCode(t(r&63))},t=function(r){if(!(r<0)){if(r<26)return 65+r;if(r<52)return 97+(r-26);if(r<62)return 48+(r-52);if(r==62)return 43;if(r==63)return 47}throw"n:"+r};return n.writeByte=function(r){for(x=x<<8|r&255,w+=8,g+=1;w>=6;)s(x>>>w-6),w-=6},n.flush=function(){if(w>0&&(s(x<<6-w),x=0,w=0),g%3!=0)for(var r=3-g%3,h=0;h<r;h+=1)l+="="},n.toString=function(){return l},n},tr=function(x){var w=x,g=0,l=0,n=0,s={};s.read=function(){for(;n<8;){if(g>=w.length){if(n==0)return-1;throw"unexpected end of file./"+n}var r=w.charAt(g);if(g+=1,r=="=")return n=0,-1;if(r.match(/^\s$/))continue;l=l<<6|t(r.charCodeAt(0)),n+=6}var h=l>>>n-8&255;return n-=8,h};var t=function(r){if(65<=r&&r<=90)return r-65;if(97<=r&&r<=122)return r-97+26;if(48<=r&&r<=57)return r-48+52;if(r==43)return 62;if(r==47)return 63;throw"c:"+r};return s},er=function(x,w){var g=x,l=w,n=new Array(x*w),s={};s.setPixel=function(i,v,_){n[v*g+i]=_},s.write=function(i){i.writeString("GIF87a"),i.writeShort(g),i.writeShort(l),i.writeByte(128),i.writeByte(0),i.writeByte(0),i.writeByte(0),i.writeByte(0),i.writeByte(0),i.writeByte(255),i.writeByte(255),i.writeByte(255),i.writeString(","),i.writeShort(0),i.writeShort(0),i.writeShort(g),i.writeShort(l),i.writeByte(0);var v=2,_=r(v);i.writeByte(v);for(var B=0;_.length-B>255;)i.writeByte(255),i.writeBytes(_,B,255),B+=255;i.writeByte(_.length-B),i.writeBytes(_,B,_.length-B),i.writeByte(0),i.writeString(";")};var t=function(i){var v=i,_=0,B=0,y={};return y.write=function(b,E){if(b>>>E)throw"length over";for(;_+E>=8;)v.writeByte(255&(b<<_|B)),E-=8-_,b>>>=8-_,B=0,_=0;B=b<<_|B,_=_+E},y.flush=function(){_>0&&v.writeByte(B)},y},r=function(i){for(var v=1<<i,_=(1<<i)+1,B=i+1,y=h(),b=0;b<v;b+=1)y.add(String.fromCharCode(b));y.add(String.fromCharCode(v)),y.add(String.fromCharCode(_));var E=j(),I=t(E);I.write(v,B);var m=0,U=String.fromCharCode(n[m]);for(m+=1;m<n.length;){var H=String.fromCharCode(n[m]);m+=1,y.contains(U+H)?U=U+H:(I.write(y.indexOf(U),B),y.size()<4095&&(y.size()==1<<B&&(B+=1),y.add(U+H)),U=H)}return I.write(y.indexOf(U),B),I.write(_,B),I.flush(),E.toByteArray()},h=function(){var i={},v=0,_={};return _.add=function(B){if(_.contains(B))throw"dup key:"+B;i[B]=v,v+=1},_.size=function(){return v},_.indexOf=function(B){return i[B]},_.contains=function(B){return typeof i[B]<"u"},_};return s},nr=function(x,w,g){for(var l=er(x,w),n=0;n<w;n+=1)for(var s=0;s<x;s+=1)l.setPixel(s,n,g(s,n));var t=j();l.write(t);for(var r=rr(),h=t.toByteArray(),i=0;i<h.length;i+=1)r.writeByte(h[i]);return r.flush(),"data:image/gif;base64,"+r};return N})();return(function(){Y.stringToBytesFuncs["UTF-8"]=function(N){function D(O){for(var L=[],k=0;k<O.length;k++){var M=O.charCodeAt(k);M<128?L.push(M):M<2048?L.push(192|M>>6,128|M&63):M<55296||M>=57344?L.push(224|M>>12,128|M>>6&63,128|M&63):(k++,M=65536+((M&1023)<<10|O.charCodeAt(k)&1023),L.push(240|M>>18,128|M>>12&63,128|M>>6&63,128|M&63))}return L}return D(N)}})(),Y})(); } catch (e) { return null; } })();
  // Share the encoder so other graphic families (stream-lower-thirds.js) can draw scan codes offline too.
  if (QR && !api.makeQr) api.makeQr = QR;
  /* A scan code opens the link as typed: add https:// when no scheme was typed (www.site.com, site.com/give). */
  function qrText(v) {
    v = String(v == null ? "" : v).trim();
    if (!v) return " ";
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(v) || /^(mailto|tel|sms|geo|wifi|upi):/i.test(v)) return v;
    return "https://" + v.replace(/^\/+/, "");
  }
  var CSS = ":is(#overlay-root,body) .kx-root .clt{position:absolute;inset:0;pointer-events:none;color:#fff;font-size:16px;line-height:normal;font-family:Montserrat,\"MCE Archivo\",sans-serif !important;font-weight:400;font-style:normal;font-stretch:normal;letter-spacing:normal;white-space:normal;text-align:left;justify-content:normal}\n:is(#overlay-root,body) .kx-root .clt *{font-family:inherit !important;box-sizing:border-box}\n:is(#overlay-root,body) .kx-root .clt .ch{display:inline-block;white-space:pre}\n:is(#overlay-root,body) .kx-root .clt [data-split]{white-space:nowrap}\n:is(#overlay-root,body) .kx-root .clt-v1 .mk{display:block;overflow:hidden;line-height:1.22}\n:is(#overlay-root,body) .kx-root .clt-v1 .pos{position:absolute}\n:is(#overlay-root,body) .kx-root .clt-v2 .mk{display:block;overflow:hidden;line-height:1.2}\n:is(#overlay-root,body) .kx-root .clt-v2 .wipe{--p:110;--q:-10;-webkit-mask-image:linear-gradient(90deg,transparent calc(var(--q)*1%),#000 calc(var(--q)*1% + 8%),#000 calc(var(--p)*1% - 8%),transparent calc(var(--p)*1%));mask-image:linear-gradient(90deg,transparent calc(var(--q)*1%),#000 calc(var(--q)*1% + 8%),#000 calc(var(--p)*1% - 8%),transparent calc(var(--p)*1%))}\n:is(#overlay-root,body) .kx-root .clt-v2 .noise{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")}\n:is(#overlay-root,body) .kx-root .clt-v2 .cols{position:absolute;display:flex}\n:is(#overlay-root,body) .kx-root .clt-v2 .col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}\n:is(#overlay-root,body) .kx-root .clt-pastor .pill .r,:is(#overlay-root,body) .kx-root .clt-honour .serif,:is(#overlay-root,body) .kx-root .clt-honour .tags,:is(#overlay-root,body) .kx-root .clt-partner .ln,:is(#overlay-root,body) .kx-root .clt-egroup .s{white-space:nowrap}\n:is(#overlay-root,body) .kx-root .clt-v2 .col .ic{width:64px;height:64px;margin-bottom:12px;color:#fff;display:block}\n:is(#overlay-root,body) .kx-root .clt-v2 .col .ic svg{width:100%;height:100%;display:block}\n:is(#overlay-root,body) .kx-root .clt-v2 .col .l{font:800 27px/1.16 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;text-transform:uppercase;letter-spacing:.005em;white-space:nowrap}\n/* 1 PRAYER */\n:is(#overlay-root,body) .kx-root .clt-prayer{--c1:#d39a1e}\n:is(#overlay-root,body) .kx-root .clt-prayer .pos{right:96px;bottom:92px;display:flex;align-items:center}\n:is(#overlay-root,body) .kx-root .clt-prayer .bar{position:relative;height:104px;min-width:760px;padding:0 64px;display:flex;align-items:center;justify-content:center}\n:is(#overlay-root,body) .kx-root .clt-prayer .bar-bg{position:absolute;inset:0;background:var(--c1);overflow:hidden}\n:is(#overlay-root,body) .kx-root .clt-prayer .shine{position:absolute;top:0;bottom:0;left:0;width:150px;background:linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-300px) skewX(-18deg)}\n:is(#overlay-root,body) .kx-root .clt-prayer .txt{position:relative;font:800 46px/1.25 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.03em}\n:is(#overlay-root,body) .kx-root .clt-prayer .logo{width:118px;height:118px;background:#fff;margin-left:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--c1);box-shadow:0 8px 30px rgba(0,0,0,.35)}\n:is(#overlay-root,body) .kx-root .clt-prayer .logo svg{width:50px;height:50px}\n:is(#overlay-root,body) .kx-root .clt-prayer .logo .lg{font:700 11px Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.2em;color:#555;white-space:nowrap}\n/* 2 EGROUP */\n:is(#overlay-root,body) .kx-root .clt-egroup{--c1:#f4ecd8;--c2:#161616}\n:is(#overlay-root,body) .kx-root .clt-egroup .pos{left:0;right:0;bottom:78px;display:flex;justify-content:center}\n:is(#overlay-root,body) .kx-root .clt-egroup .card{position:relative;padding:24px 70px 26px;text-align:center;color:var(--c2)}\n:is(#overlay-root,body) .kx-root .clt-egroup .bg{position:absolute;inset:0;background:var(--c1);box-shadow:0 10px 40px rgba(0,0,0,.35)}\n:is(#overlay-root,body) .kx-root .clt-egroup .frame{position:absolute;inset:9px;border:2px solid var(--c2)}\n:is(#overlay-root,body) .kx-root .clt-egroup .inner{position:relative}\n:is(#overlay-root,body) .kx-root .clt-egroup .s{font:600 31px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important}\n:is(#overlay-root,body) .kx-root .clt-egroup .big{font:400 112px/1.12 Anton,\"Bebas Neue\",Impact,sans-serif !important;letter-spacing:.005em}\n/* 3 TEXT TO GIVE */\n:is(#overlay-root,body) .kx-root .clt-text{--c1:#e5392d}\n:is(#overlay-root,body) .kx-root .clt-text .pos{left:0;right:0;bottom:66px;height:116px}\n:is(#overlay-root,body) .kx-root .clt-text .bg{position:absolute;inset:0;background:rgba(12,12,14,.74);backdrop-filter:blur(6px)}\n:is(#overlay-root,body) .kx-root .clt-text .line{position:absolute;left:0;right:0;top:0;height:4px;background:var(--c1)}\n:is(#overlay-root,body) .kx-root .clt-text .row{position:absolute;inset:0;padding-left:96px;display:flex;align-items:center;gap:44px}\n:is(#overlay-root,body) .kx-root .clt-text .logo{width:86px;height:86px;background:var(--c1);display:grid;place-items:center}\n:is(#overlay-root,body) .kx-root .clt-text .logo svg{width:52px;height:52px}\n:is(#overlay-root,body) .kx-root .clt-text .txt{font:600 48px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.1em;text-transform:uppercase}\n/* 4 PARTNER */\n:is(#overlay-root,body) .kx-root .clt-partner{--c1:#f2b632}\n:is(#overlay-root,body) .kx-root .clt-partner .scrim{position:absolute;left:0;right:0;bottom:0;height:480px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.62))}\n:is(#overlay-root,body) .kx-root .clt-partner .pos{left:96px;bottom:92px;display:flex;align-items:center;gap:36px}\n:is(#overlay-root,body) .kx-root .clt-partner .qr{position:relative;width:184px;height:184px;background:#fff;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)}\n:is(#overlay-root,body) .kx-root .clt-partner .qr .code{width:100%;height:100%}\n:is(#overlay-root,body) .kx-root .clt-partner .qr svg{display:block;width:100%;height:100%}\n:is(#overlay-root,body) .kx-root .clt-partner .scan{position:absolute;left:8px;right:8px;top:14px;height:4px;background:var(--c1);box-shadow:0 0 16px var(--c1);opacity:0}\n:is(#overlay-root,body) .kx-root .clt-partner .rule{width:5px;height:150px;background:var(--c1)}\n:is(#overlay-root,body) .kx-root .clt-partner .ln{font:600 42px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;color:#fbf5e4;text-shadow:0 2px 14px rgba(0,0,0,.65)}\n:is(#overlay-root,body) .kx-root .clt-partner .ln.h{font-weight:800;letter-spacing:.07em;text-transform:uppercase}\n/* 5 MOMENT */\n:is(#overlay-root,body) .kx-root .clt-honour{--c1:#f6bba5;--c2:#000000;--c3:#ffffff;--c4:#ffffff;--c5:#000000;--c6:#2a1a16}\n:is(#overlay-root,body) .kx-root .clt-honour .pos{left:96px;right:96px;bottom:70px}\n:is(#overlay-root,body) .kx-root .clt-honour .r1{display:flex;height:78px}\n:is(#overlay-root,body) .kx-root .clt-honour .time{background:var(--c2);color:var(--c3);min-width:210px;display:flex;align-items:center;justify-content:center;font:800 42px Montserrat,\"MCE Archivo\",Arial,sans-serif !important;font-variant-numeric:tabular-nums;padding:0 24px}\n:is(#overlay-root,body) .kx-root .clt-honour .title{flex:1;background:var(--c4);color:var(--c5);display:flex;align-items:center;justify-content:center;font:800 40px Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.03em;text-transform:uppercase}\n:is(#overlay-root,body) .kx-root .clt-honour .r2{background:var(--c1);color:var(--c6);text-align:center;padding:14px 30px 16px}\n:is(#overlay-root,body) .kx-root .clt-honour .serif{font:500 58px/1.3 'Playfair Display',Georgia,serif !important}\n:is(#overlay-root,body) .kx-root .clt-honour .tags{font:700 24px/1.5 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.06em;text-transform:uppercase}\n/* 6 WAYS TO GIVE */\n:is(#overlay-root,body) .kx-root .clt-give{--c1:#2f45f0;--c2:#0c1458}\n:is(#overlay-root,body) .kx-root .clt-give .pos{left:96px;bottom:80px}\n:is(#overlay-root,body) .kx-root .clt-give .box{position:relative;border:8px solid var(--c1);background:linear-gradient(110deg,var(--c2),#142187 60%,var(--c2));overflow:hidden;display:flex;align-items:center;gap:40px;padding:30px 60px 30px 48px;box-shadow:0 14px 44px rgba(0,0,0,.45)}\n:is(#overlay-root,body) .kx-root .clt-give .glow{position:absolute;top:-60%;bottom:-60%;left:0;width:520px;background:radial-gradient(closest-side,rgba(120,150,255,.55),transparent);transform:translateX(-200px)}\n:is(#overlay-root,body) .kx-root .clt-give .shine{position:absolute;top:0;bottom:0;left:0;width:170px;background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);transform:translateX(-400px) skewX(-18deg)}\n:is(#overlay-root,body) .kx-root .clt-give .ttl{position:relative;font:400 92px/1 'Bebas Neue',Anton,Impact,sans-serif !important;letter-spacing:.015em;white-space:nowrap}\n:is(#overlay-root,body) .kx-root .clt-give .div{position:relative;width:3px;align-self:stretch;background:rgba(255,255,255,.55)}\n:is(#overlay-root,body) .kx-root .clt-give .rows{position:relative;display:grid;gap:12px}\n:is(#overlay-root,body) .kx-root .clt-give .rw{display:flex;align-items:center;gap:16px;font:800 30px/1.2 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.02em;text-transform:uppercase;white-space:nowrap}\n:is(#overlay-root,body) .kx-root .clt-give .ic{flex:none;width:36px;height:36px;border-radius:50%;background:#fff;color:var(--c2);display:grid;place-items:center}\n:is(#overlay-root,body) .kx-root .clt-give .ic svg{width:20px;height:20px}\n/* ---------- 1 HUD (blue tech) ---------- */\n:is(#overlay-root,body) .kx-root .clt-hud{--accent:#8fe3ff}\n:is(#overlay-root,body) .kx-root .clt-hud .pos{position:absolute;left:0;bottom:34px;width:1920px;height:220px}\n:is(#overlay-root,body) .kx-root .clt-hud svg.hs{position:absolute;inset:0;overflow:visible}\n:is(#overlay-root,body) .kx-root .clt-hud .frame path,:is(#overlay-root,body) .kx-root .clt-hud .chev path{stroke:var(--accent);fill:none}\n:is(#overlay-root,body) .kx-root .clt-hud .frame,:is(#overlay-root,body) .kx-root .clt-hud .chev{filter:drop-shadow(0 0 5px var(--accent)) drop-shadow(0 0 16px #2f7dff)}\n:is(#overlay-root,body) .kx-root .clt-hud .tw{position:absolute;left:0;top:24px;width:640px;height:166px;display:flex;flex-direction:column;align-items:center;justify-content:center}\n:is(#overlay-root,body) .kx-root .clt-hud .ttl{font:800 66px/1.05 Saira,Montserrat,Arial,sans-serif !important;letter-spacing:.09em;text-shadow:0 0 14px rgba(120,200,255,.9),0 0 3px #fff;padding-left:.09em}\n:is(#overlay-root,body) .kx-root .clt-hud .sub{font:700 26px/1.2 'Saira Semi Condensed',Montserrat,Arial,sans-serif !important;letter-spacing:.07em;margin-top:6px;text-transform:uppercase;text-shadow:0 0 8px rgba(80,160,255,.9)}\n:is(#overlay-root,body) .kx-root .clt-hud .items{position:absolute;left:660px;width:1110px;top:70px;height:76px;display:flex;align-items:center;justify-content:space-around}\n:is(#overlay-root,body) .kx-root .clt-hud .it{display:flex;align-items:center;gap:16px}\n:is(#overlay-root,body) .kx-root .clt-hud .it .ic{width:46px;height:46px;flex:none}\n:is(#overlay-root,body) .kx-root .clt-hud .it .ic svg{width:100%;height:100%;display:block}\n:is(#overlay-root,body) .kx-root .clt-hud .it .tx{font:700 24px/1.02 'Saira Semi Condensed',Montserrat,Arial,sans-serif !important;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}\n/* ---------- 2 FIRE ---------- */\n:is(#overlay-root,body) .kx-root .clt-fire{--accent:#ff5a14}\n:is(#overlay-root,body) .kx-root .clt-fire .band{position:absolute;left:0;right:0;bottom:0;height:276px;background:#0d0201;overflow:hidden}\n:is(#overlay-root,body) .kx-root .clt-fire .fa{position:absolute;inset:0;background:\n radial-gradient(ellipse 22% 75% at 6% 0%,rgba(255,110,30,.95),transparent 70%),\n radial-gradient(ellipse 18% 60% at 30% -5%,rgba(255,70,10,.85),transparent 70%),\n radial-gradient(ellipse 25% 70% at 58% -8%,rgba(255,90,20,.8),transparent 70%),\n radial-gradient(ellipse 20% 80% at 84% 0%,rgba(255,120,40,.9),transparent 70%),\n radial-gradient(ellipse 14% 90% at 99% 60%,rgba(255,80,10,.85),transparent 70%),\n radial-gradient(ellipse 30% 60% at 40% 110%,rgba(200,30,0,.6),transparent 70%)}\n:is(#overlay-root,body) .kx-root .clt-fire .fb{position:absolute;top:0;bottom:0;left:0;width:200%;opacity:.55;mix-blend-mode:screen;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='280'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.0125 .05' numOctaves='4' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 1.4 -.3 0 0 0 .55 -.15 0 0 0 .1 -.05 0 0 0 1.6 -.6'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E\");background-size:640px 280px}\n:is(#overlay-root,body) .kx-root .clt-fire .edge{position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,transparent,var(--accent) 15%,#ffb36b 50%,var(--accent) 85%,transparent);box-shadow:0 0 18px var(--accent),0 0 40px var(--accent)}\n:is(#overlay-root,body) .kx-root .clt-fire .tbox{position:absolute;left:48px;top:830px;width:524px;height:132px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.5)}\n:is(#overlay-root,body) .kx-root .clt-fire .tbox .t{font:400 100px/1.12 Anton,\"Bebas Neue\",Impact,sans-serif !important;color:#0a0a0a;letter-spacing:-.005em}\n:is(#overlay-root,body) .kx-root .clt-fire .sub{position:absolute;left:48px;width:524px;top:982px;text-align:center}\n:is(#overlay-root,body) .kx-root .clt-fire .sub div{font:800 22px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.01em;text-transform:uppercase}\n:is(#overlay-root,body) .kx-root .clt-fire .fpanel{position:absolute;left:640px;width:1210px;top:830px;height:226px;background:rgba(0,0,0,.93)}\n:is(#overlay-root,body) .kx-root .clt-fire .cols{inset:0}\n/* ---------- 3 NAVY (torn paper) ---------- */\n:is(#overlay-root,body) .kx-root .clt-navy .band{position:absolute;left:0;right:0;bottom:0;height:290px;background:#1e3366}\n:is(#overlay-root,body) .kx-root .clt-navy .band .mot{position:absolute;inset:0;background:\n radial-gradient(ellipse 30% 60% at 15% 40%,rgba(90,120,190,.35),transparent 70%),\n radial-gradient(ellipse 25% 50% at 55% 70%,rgba(10,20,50,.5),transparent 70%),\n radial-gradient(ellipse 20% 60% at 80% 30%,rgba(80,110,180,.3),transparent 70%)}\n:is(#overlay-root,body) .kx-root .clt-navy .band .nz{position:absolute;inset:0;opacity:.32;mix-blend-mode:overlay}\n:is(#overlay-root,body) .kx-root .clt-navy .patch{position:absolute;right:0;top:0;width:130px;height:62px;background:#8c826f;opacity:.9}\n:is(#overlay-root,body) .kx-root .clt-navy .tw{position:absolute;left:88px;top:838px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.45))}\n:is(#overlay-root,body) .kx-root .clt-navy .ttl{padding:6px 30px 10px 20px;font:700 104px/1.05 'Grenze Gotisch',Georgia,serif !important;background:linear-gradient(180deg,#ffe28a,#f1bf4e 50%,#c98d2a);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}\n:is(#overlay-root,body) .kx-root .clt-navy .sub{position:absolute;left:110px;top:976px}\n:is(#overlay-root,body) .kx-root .clt-navy .sub div{font:800 22px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;text-transform:uppercase}\n:is(#overlay-root,body) .kx-root .clt-navy .cols{left:690px;right:60px;top:830px;height:220px}\n/* ---------- 4 PASTOR ---------- */\n:is(#overlay-root,body) .kx-root .clt-pastor .band{position:absolute;left:0;right:0;bottom:0;height:270px;background:#070707;overflow:hidden}\n:is(#overlay-root,body) .kx-root .clt-pastor .tex{position:absolute;top:0;bottom:0;left:-200px;width:2400px;background:\n repeating-linear-gradient(-16deg,rgba(255,255,255,.055) 0 2px,transparent 2px 7px),\n linear-gradient(-16deg,transparent 30%,rgba(255,255,255,.10) 36%,transparent 40%,transparent 52%,rgba(255,255,255,.08) 57%,transparent 62%,transparent 75%,rgba(255,255,255,.12) 80%,transparent 86%)}\n:is(#overlay-root,body) .kx-root .clt-pastor .nz{position:absolute;inset:0;opacity:.18}\n:is(#overlay-root,body) .kx-root .clt-pastor .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.55),transparent 45%)}\n:is(#overlay-root,body) .kx-root .clt-pastor .streak{position:absolute;top:0;bottom:0;left:0;width:220px;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent);transform:translateX(-400px) skewX(-18deg)}\n:is(#overlay-root,body) .kx-root .clt-pastor .name{position:absolute;left:118px;top:832px}\n:is(#overlay-root,body) .kx-root .clt-pastor .name div{font:800 98px/1.15 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:-.04em}\n:is(#overlay-root,body) .kx-root .clt-pastor .pill{position:absolute;left:62px;top:968px;width:700px;height:66px;border-radius:33px;background:linear-gradient(180deg,#8a8a8a,#5a5a5a 55%,#4a4a4a);border:2px solid #a8a8a8;box-shadow:inset 0 2px 0 rgba(255,255,255,.25),0 4px 14px rgba(0,0,0,.5)}\n:is(#overlay-root,body) .kx-root .clt-pastor .pill .mk{position:absolute;left:44px;top:0;bottom:0;display:flex;align-items:center}\n:is(#overlay-root,body) .kx-root .clt-pastor .pill .r{font:800 36px/1.2 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;letter-spacing:.01em;text-transform:uppercase}\n:is(#overlay-root,body) .kx-root .clt-pastor .br{position:absolute;width:28px;height:28px;border-color:#c9c9c9;border-style:solid;border-width:0}\n:is(#overlay-root,body) .kx-root .clt-pastor .b1{right:40px;top:838px;border-top-width:3px;border-right-width:3px}\n:is(#overlay-root,body) .kx-root .clt-pastor .b2{right:40px;top:1030px;border-bottom-width:3px;border-right-width:3px}\n:is(#overlay-root,body) .kx-root .clt-pastor .tog{position:absolute;right:46px;top:936px;width:36px;height:20px;border:2px solid #c9c9c9;border-radius:10px}\n:is(#overlay-root,body) .kx-root .clt-pastor .tog::after{content:\"\";position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#c9c9c9}\n/* ---------- 5 GOLD (maroon) ---------- */\n:is(#overlay-root,body) .kx-root .clt-gold .band{position:absolute;left:0;right:0;bottom:0;height:270px;overflow:hidden;background:radial-gradient(ellipse 60% 140% at 38% 50%,#740d1d,#45050f 55%,#1e0206)}\n:is(#overlay-root,body) .kx-root .clt-gold .bok{position:absolute;border-radius:50%;filter:blur(6px)}\n:is(#overlay-root,body) .kx-root .clt-gold .ray{position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,160,160,.08) 40%,transparent 48%,transparent 60%,rgba(255,140,140,.06) 66%,transparent 72%)}\n:is(#overlay-root,body) .kx-root .clt-gold .tw{position:absolute;left:60px;top:826px;filter:drop-shadow(0 0 10px rgba(255,190,80,.55)) drop-shadow(0 3px 2px rgba(0,0,0,.6))}\n:is(#overlay-root,body) .kx-root .clt-gold .ttl{padding:10px 40px 18px 30px;font:400 100px/1.15 'Kaushan Script',cursive !important;background:linear-gradient(180deg,#fff4c4,#f6c75a 45%,#c27f22 80%,#f2c45e);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}\n:is(#overlay-root,body) .kx-root .clt-gold .flare{position:absolute;left:40px;top:952px;width:620px;height:8px;border-radius:50%;background:radial-gradient(closest-side,#fff6d0,rgba(255,190,70,.8) 40%,transparent);filter:blur(1px);box-shadow:0 0 30px rgba(255,180,60,.6)}\n:is(#overlay-root,body) .kx-root .clt-gold .spk{position:absolute;width:44px;height:44px;color:#fff2c0;filter:drop-shadow(0 0 8px #ffd27a)}\n:is(#overlay-root,body) .kx-root .clt-gold .s1{left:52px;top:842px}\n:is(#overlay-root,body) .kx-root .clt-gold .s2{left:560px;top:930px;width:30px;height:30px}\n:is(#overlay-root,body) .kx-root .clt-gold .sub{position:absolute;left:96px;top:982px}\n:is(#overlay-root,body) .kx-root .clt-gold .sub div{font:800 22px/1.3 Montserrat,\"MCE Archivo\",Arial,sans-serif !important;text-transform:uppercase}\n:is(#overlay-root,body) .kx-root .clt-gold .cols{left:640px;right:60px;top:830px;height:220px}";
  var MARKUP = {
 "prayer": "<div class=\"pos\"><div class=\"bar\"><div class=\"bar-bg\"><div class=\"shine\"></div></div><div class=\"mk\" style=\"position:relative\"><div class=\"txt\" data-f=\"text\" data-split></div></div></div><div class=\"logo\"><svg viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\" stroke-linejoin=\"miter\"><path d=\"M38 8H18L8 18v12l10 10h20\"/><path d=\"M30 16h-9l-5 5v6l5 5h9\"/></svg><div class=\"lg\" data-f=\"logo\"></div></div></div>",
 "egroup": "<div class=\"pos\"><div class=\"card\"><div class=\"bg\"></div><div class=\"frame\"></div><div class=\"inner\"><div class=\"mk\"><div class=\"s\" data-f=\"small\"></div></div><div class=\"mk\"><div class=\"big\" data-f=\"big\" data-split></div></div></div></div></div>",
 "text": "<div class=\"pos\"><div class=\"bg\"></div><div class=\"line\"></div><div class=\"row\"><div class=\"logo\"><svg viewBox=\"0 0 48 48\" fill=\"#fff\"><path d=\"M3 40 18 14l9 14 6-8 12 20z\"/><path d=\"M18 14l4 6-4-2-3 4z\" fill=\"rgba(0,0,0,.18)\"/></svg></div><div class=\"mk\"><div class=\"txt\" data-f=\"text\" data-split></div></div></div></div>",
 "partner": "<div class=\"scrim\"></div><div class=\"pos\"><div class=\"qr\"><div class=\"code\"></div><div class=\"scan\"></div></div><div class=\"rule\"></div><div class=\"lines\"><div class=\"mk\"><div class=\"ln h\" data-f=\"l1\"></div></div><div class=\"mk\"><div class=\"ln\" data-f=\"l2\"></div></div><div class=\"mk\"><div class=\"ln\" data-f=\"l3\"></div></div></div></div>",
 "honour": "<div class=\"pos\"><div class=\"r1\"><div class=\"time\"><div class=\"mk\"><div class=\"tm\" data-f=\"time\"></div></div></div><div class=\"title\"><div class=\"mk\"><div data-f=\"title\" data-split></div></div></div></div><div class=\"r2\"><div class=\"mk\"><div class=\"serif\" data-f=\"line\"></div></div><div class=\"mk\"><div class=\"tags\" data-f=\"tags\"></div></div></div></div>",
 "give": "<div class=\"pos\"><div class=\"box\"><div class=\"glow\"></div><div class=\"shine\"></div><div class=\"mk\" style=\"position:relative\"><div class=\"ttl\" data-f=\"title\" data-split></div></div><div class=\"div\"></div><div class=\"rows\"><div class=\"rw\"><span class=\"ic\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18\"/></svg></span><span data-f=\"r1\"></span></div><div class=\"rw\"><span class=\"ic\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H11l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z\"/></svg></span><span data-f=\"r2\"></span></div><div class=\"rw\"><span class=\"ic\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.500a2.500 2.500 0 0 1 0 5z\"/></svg></span><span data-f=\"r3\"></span></div></div></div></div>",
 "hud": "<div class=\"pos\"><svg class=\"hs\" viewBox=\"0 0 1920 220\" width=\"1920\" height=\"220\"><defs><linearGradient id=\"hudL__UID__\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#0c2f9e\"/><stop offset=\".55\" stop-color=\"#1747d6\"/><stop offset=\"1\" stop-color=\"#0a1f74\"/></linearGradient><radialGradient id=\"hudR__UID__\" cx=\".3\" cy=\".5\" r=\".7\"><stop offset=\"0\" stop-color=\"#5fb8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#5fb8ff\" stop-opacity=\"0\"/></radialGradient><pattern id=\"circ__UID__\" width=\"140\" height=\"84\" patternUnits=\"userSpaceOnUse\"><g stroke=\"#7cd4ff\" stroke-width=\"1.6\" fill=\"none\" opacity=\".55\"><path d=\"M0 18h38l10 10h34M64 0v14l14 14h40l10-10h12M8 84V66l12-12h34l8 8h26M100 84V58l10-10h30M40 42h18l8 8v12\"/></g><g fill=\"#b8ecff\" opacity=\".8\"><circle cx=\"82\" cy=\"28\" r=\"3\"/><circle cx=\"20\" cy=\"54\" r=\"2.6\"/><circle cx=\"66\" cy=\"62\" r=\"2.6\"/><circle cx=\"128\" cy=\"18\" r=\"2.4\"/></g></pattern><linearGradient id=\"scanG__UID__\" x1=\"0\" x2=\"1\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\"0\"/><stop offset=\".5\" stop-color=\"#bfefff\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient><clipPath id=\"panelClip__UID__\"><path d=\"M0 24H606L650 68V146L606 190H0Z\"/></clipPath><clipPath id=\"stripClip__UID__\"><rect class=\"stripR\" x=\"640\" y=\"40\" width=\"1180\" height=\"140\"/></clipPath></defs><g class=\"hpanel\"><path d=\"M0 24H606L650 68V146L606 190H0Z\" fill=\"url(#hudL__UID__)\"/><path d=\"M0 24H606L650 68V146L606 190H0Z\" fill=\"url(#circ__UID__)\"/><path d=\"M0 24H606L650 68V146L606 190H0Z\" fill=\"url(#hudR__UID__)\"/><g clip-path=\"url(#panelClip__UID__)\"><rect class=\"scan\" x=\"-200\" y=\"0\" width=\"160\" height=\"220\" fill=\"url(#scanG__UID__)\"/></g><path d=\"M0 24H606L650 68V146L606 190H0\" fill=\"none\" stroke=\"#6fc7ff\" stroke-width=\"2.5\" opacity=\".9\"/></g><g class=\"strip\" clip-path=\"url(#stripClip__UID__)\"><path d=\"M652 70H1752L1790 108L1752 146H652Z\" fill=\"#06123f\" stroke=\"#3a8cff\" stroke-width=\"3\"/></g><g class=\"frame\"><path class=\"fT\" d=\"M0 8H614L662 54H1764L1814 108\" stroke-width=\"4\"/><path class=\"fB\" d=\"M0 206H614L662 162H1764L1814 108\" stroke-width=\"4\"/></g><g class=\"chev\"><path class=\"c1\" d=\"M1838 76l30 32-30 32\" stroke-width=\"6\"/><path class=\"c2\" d=\"M1872 88l18 20-18 20\" stroke-width=\"5\"/></g></svg><div class=\"tw\"><div class=\"ttl\" data-f=\"title\" data-split></div><div class=\"sub\" data-f=\"sub\" data-split></div></div><div class=\"items\"></div></div>",
 "fire": "<div class=\"band\"><div class=\"fa\"></div><div class=\"fb\"></div><div class=\"edge\"></div></div><div class=\"tbox\"><div class=\"mk\"><div class=\"t\" data-f=\"title\" data-split></div></div></div><div class=\"sub\"><div class=\"mk\"><div data-f=\"sub\"></div></div></div><div class=\"fpanel\"><div class=\"cols\"></div></div>",
 "navy": "<div class=\"band\"><div class=\"mot\"></div><div class=\"nz noise\"></div><div class=\"patch\"></div></div><div class=\"tw\"><div class=\"ttl wipe\" data-f=\"title\"></div></div><div class=\"sub\"><div class=\"mk\"><div data-f=\"sub\"></div></div></div><div class=\"cols\"></div>",
 "pastor": "<div class=\"band\"><div class=\"tex\"></div><div class=\"nz noise\"></div><div class=\"shade\"></div><div class=\"streak\"></div></div><div class=\"name\"><div class=\"mk\"><div data-f=\"name\" data-split></div></div></div><div class=\"pill\"><div class=\"mk\"><div class=\"r\" data-f=\"role\"></div></div></div><div class=\"br b1\"></div><div class=\"tog\"></div><div class=\"br b2\"></div>",
};
  var VER = {"prayer": 1, "egroup": 1, "text": 1, "partner": 1, "honour": 1, "give": 1, "hud": 2, "fire": 2, "navy": 2, "pastor": 2};

  /* ======================================================================
   * Shared helpers (ported from the church-lower-thirds test benches)
   * ==================================================================== */
  var SC = ":is(#overlay-root,body) .kx-root ";
  var DESIGN_W = 1920, DESIGN_H = 1080;
  var uidSeq = 0;

  function $(s, r) { return r.querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function setText(el, v) {
    v = String(v == null ? "" : v);
    if (el.hasAttribute("data-split")) {
      el.innerHTML = Array.from(v).map(function (c) {
        return c === " " ? '<span class="ch" data-c=" ">&nbsp;</span>' : '<span class="ch" data-c="' + esc(c).replace(/"/g, "&quot;") + '">' + esc(c) + "</span>";
      }).join("");
    } else el.textContent = v;
  }
  function chs(el) { return el ? $$(".ch", el) : []; }
  function stg(n, max, each) { max = max == null ? .5 : max; each = each == null ? .02 : each; return { amount: Math.min(max, Math.max(.001, (n - 1) * each)) }; }
  function stgEnd(n, max, each) { max = max == null ? .25 : max; each = each == null ? .012 : each; return { amount: Math.min(max, Math.max(.001, (n - 1) * each)), from: "end" }; }
  function hex(v, fallback) { v = String(v || "").trim(); return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : fallback; }

  /* hologram power-on flicker eases (HUD) */
  function flick(p) { return p < .12 ? 0 : p < .2 ? .85 : p < .3 ? .15 : p < .42 ? 1 : p < .5 ? .35 : p < .62 ? 1 : p < .68 ? .7 : 1; }
  function flickOut(p) { return 1 - flick(p); }

  var GLY = "ABCDEFGHJKLMNPRSTUVXYZ0123456789#%&*<>/=+";
  function scramble(tl, el, at, dur, out) {
    var cs = chs(el), n = cs.length; if (!n) return;
    cs.forEach(function (c) { c.style.width = c.offsetWidth + "px"; c.style.textAlign = "center"; });
    if (!out) cs.forEach(function (c) { c.style.opacity = 0; });
    var o = { v: 0 };
    tl.to(o, { v: 1, duration: dur, ease: "none", onUpdate: function () {
      var v = o.v;
      cs.forEach(function (c, i) {
        var a = i / n * .55, b = a + .45, real = c.dataset.c;
        var rnd = function () { c.textContent = real.trim() ? GLY[(Math.random() * GLY.length) | 0] : " "; };
        if (!out) { if (v < a) c.style.opacity = 0; else if (v < b) { c.style.opacity = 1; rnd(); } else { c.style.opacity = 1; c.textContent = real === " " ? " " : real; } }
        else { if (v < a) { c.style.opacity = 1; c.textContent = real === " " ? " " : real; } else if (v < b) { c.style.opacity = 1; rnd(); } else c.style.opacity = 0; }
      });
    } }, at);
  }
  function colsIn(tl, root, at) {
    $$(".col", root).forEach(function (c, i) {
      var t = at + i * .13;
      tl.fromTo($(".ic", c), { y: -28, scale: .5, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .55, ease: "back.out(2.2)" }, t)
        .fromTo($$(".l", c), { yPercent: 120 }, { yPercent: 0, duration: .6, ease: "expo.out", stagger: .07 }, t + .08);
    });
  }
  function colsOut(tl, root, at) {
    $$(".col", root).reverse().forEach(function (c, i) {
      var t = at + i * .07;
      tl.to($$(".l", c), { yPercent: -120, duration: .3, ease: "power3.in", stagger: .04 }, t)
        .to($(".ic", c), { scale: .4, opacity: 0, y: -10, duration: .28, ease: "power2.in" }, t + .06);
    });
  }
  function len(p) { return p.getTotalLength(); }

  /* Auto-fit: churches type their own text, so a line that is wider than its box is
     scaled down (to no less than 30%) instead of spilling out of the design. */
  function colW(el) { var c = el.closest(".cols"); return c ? c.clientWidth / 3 - 20 : 380; }
  function fitText(sec, rules) {
    (rules || []).forEach(function (r) {
      $$(r[0], sec).forEach(function (el) {
        var max = typeof r[1] === "function" ? r[1](el) : r[1];
        var w = el.scrollWidth;
        if (!max || !w || w <= max) return;
        var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (fs) el.style.setProperty("font-size", Math.max(fs * .3, fs * max / w).toFixed(2) + "px", "important");
      });
    });
  }

  /* ---------- icons for the "Ways to give" item columns ---------- */
  var IC = {
    click: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 19l19 8-8.5 3 6.5 9.5-4.5 3-6.5-9.5L21 39z"/><path d="M15 6l2 6.5M6 15l6.5 2M25 6.5l-3.2 5.6M6.5 25l5.6-3.2"/></svg>',
    chat: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"><path d="M8 9h32a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H22l-9 7v-7H8a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z"/><circle cx="15.5" cy="21" r="2.4" fill="currentColor" stroke="none"/><circle cx="24" cy="21" r="2.4" fill="currentColor" stroke="none"/><circle cx="32.5" cy="21" r="2.4" fill="currentColor" stroke="none"/></svg>',
    mail: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"><rect x="5" y="11" width="38" height="27" rx="2.5"/><path d="M6 13l18 14 18-14M6 36l13-11M42 36L29 25"/></svg>'
  };
  var ICONS = ["click", "chat", "mail"];
  function fillCols(sec) {
    $$(".cols", sec).forEach(function (c) {
      c.innerHTML = [1, 2, 3].map(function (i) {
        return '<div class="col"><span class="ic">' + IC[ICONS[i - 1]] + '</span><div class="mk"><div class="l" data-f="item' + i + 'a"></div></div><div class="mk"><div class="l" data-f="item' + i + 'b"></div></div></div>';
      }).join("");
    });
  }

  /* ---------- field sets ---------- */
  var ITEMS = [
    ["item1a", "Item 1 – line 1", "Online at"], ["item1b", "Item 1 – line 2", "churchname.com"],
    ["item2a", "Item 2 – line 1", "Text any amount to"], ["item2b", "Item 2 – line 2", "54321 to get started"],
    ["item3a", "Item 3 – line 1", "Cash or check"], ["item3b", "Item 3 – line 2", "using an envelope"]
  ];
  function text(key, label, def) { return [key, key, label, def, "text"]; }
  function color(key, label, def, cssVar) { return [key, key, label, def, "color", null, cssVar]; }
  function select(key, label, def, options) { return [key, key, label, def, "select", options]; }
  function itemFields() { return ITEMS.map(function (f) { return text(f[0], f[1], f[2]); }); }

  /* ======================================================================
   * The 11 designs. `H` = height of the design's band, measured up from the
   * bottom of the 1920×1080 frame (glows and shadows may draw beyond it).
   * in/out/ambient are the original GSAP timelines, unchanged in feel.
   * ==================================================================== */
  var D = {};

  /* ---------------- v1 · 1 · Prayer link ---------------- */
  D.prayer = {
    box: ".pos", // a boxed graphic: Position left / centre / right moves this box
    fit: [[".txt", 1500], [".logo .lg", 108]],
    id: "ch-prayer", name: "Prayer Link", tech: "Gold bar wipes in from the right with a badge tile and a light sweep",
    category: "general", tags: ["Church", "Graphics", "Announcement", "Prayer", "Motion", "Animated"], color: "#d39a1e", H: 228, hold: 8,
    fields: [text("link", "Link text", "www.yourchurchname.com/prayer"), text("badge", "Badge caption", "YOUR CHURCH"), color("colBar", "Bar & badge colour", "#d39a1e", "c1")],
    bind: { link: "text", badge: "logo" },
    in: function (tl, q) {
      var bg = q(".bar-bg"), sh = q(".shine"), logo = q(".logo"), c = chs(q(".txt")), lg = q(".logo svg");
      tl.fromTo(logo, { scale: 0, rotation: -14 }, { scale: 1, rotation: 0, duration: .6, ease: "back.out(2)" }, 0)
        .fromTo(lg, { rotation: -90, scale: .4 }, { rotation: 0, scale: 1, duration: .7, ease: "expo.out" }, .1)
        .fromTo(bg, { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)", duration: .85, ease: "expo.out" }, .12)
        .fromTo(c, { yPercent: 125 }, { yPercent: 0, duration: .65, ease: "expo.out", stagger: stg(c.length, .5, .018) }, .38)
        .fromTo(sh, { x: -300 }, { x: q(".bar").offsetWidth + 300, duration: .9, ease: "power2.inOut" }, .6);
    },
    out: function (tl, q) {
      var bg = q(".bar-bg"), logo = q(".logo"), c = chs(q(".txt"));
      tl.to(c, { yPercent: -125, duration: .3, ease: "power3.in", stagger: stgEnd(c.length, .16, .008) }, 0)
        .to(bg, { clipPath: "inset(0 0 0 100%)", duration: .55, ease: "power3.inOut" }, .4)
        .to(logo, { scale: 0, rotation: 12, duration: .4, ease: "back.in(2)" }, .8);
    }
  };

  /* ---------------- v1 · 2 · Join a group ---------------- */
  D.egroup = {
    box: ".card", // a boxed graphic: Position left / centre / right moves this box
    fit: [[".big", 1700], [".s", 1700]],
    id: "ch-join-group", name: "Join a Group", tech: "Cream card opens from the centre, condensed web address rises letter by letter",
    category: "general", tags: ["Church", "Graphics", "Announcement", "Groups", "Motion", "Animated"], color: "#f4ecd8", H: 312, hold: 8,
    fields: [text("smallLine", "Small line", "You can still join a small group!"), text("bigLine", "Big line", "yourchurchname.com/groups"),
      color("colCard", "Card colour", "#f4ecd8", "c1"), color("colInk", "Text & frame colour", "#161616", "c2")],
    bind: { smallLine: "small", bigLine: "big" },
    in: function (tl, q) {
      var bg = q(".bg"), fr = q(".frame"), s = q(".s"), c = chs(q(".big"));
      tl.fromTo(bg, { clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0% 0 0%)", duration: .85, ease: "expo.out" }, 0)
        .fromTo(fr, { clipPath: "inset(0 50% 0 50%)", scale: 1.07 }, { clipPath: "inset(0 0% 0 0%)", scale: 1, duration: 1, ease: "expo.out" }, .08)
        .fromTo(s, { yPercent: 135 }, { yPercent: 0, duration: .55, ease: "expo.out" }, .3)
        .fromTo(c, { yPercent: 118 }, { yPercent: 0, duration: .7, ease: "expo.out", stagger: stg(c.length, .4, .016) }, .36);
    },
    out: function (tl, q) {
      var bg = q(".bg"), fr = q(".frame"), s = q(".s"), c = chs(q(".big"));
      tl.to(c, { yPercent: -118, duration: .36, ease: "power3.in", stagger: stgEnd(c.length, .2, .01) }, 0)
        .to(s, { yPercent: -135, duration: .3, ease: "power3.in" }, .14)
        .to(fr, { clipPath: "inset(0 50% 0 50%)", duration: .5, ease: "power3.inOut" }, .25)
        .to(bg, { clipPath: "inset(0 50% 0 50%)", duration: .5, ease: "power3.inOut" }, .32);
    }
  };

  /* ---------------- v1 · 3 · Text to give ---------------- */
  D.text = {
    fit: [[".txt", 1560]],
    id: "ch-text-give", name: "Text to Give", tech: "Full-width dark bar with an accent line, badge pops and the message slides in",
    category: "general", tags: ["Church", "Graphics", "Giving", "Motion", "Animated"], color: "#e5392d", H: 196, hold: 8,
    fields: [text("message", "Message", "Text “GIVE” to 12345"), color("colAccent", "Accent colour", "#e5392d", "c1")],
    bind: { message: "text" },
    in: function (tl, q) {
      var bg = q(".bg"), ln = q(".line"), logo = q(".logo"), c = chs(q(".txt"));
      tl.fromTo(bg, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .9, ease: "expo.out" }, 0)
        .fromTo(ln, { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 1.1, ease: "expo.out" }, .05)
        .fromTo(logo, { scale: 0, rotation: -20 }, { scale: 1, rotation: 0, duration: .55, ease: "back.out(2.2)" }, .3)
        .fromTo(c, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: .55, ease: "power3.out", stagger: stg(c.length, .5, .022) }, .42);
    },
    out: function (tl, q) {
      var bg = q(".bg"), ln = q(".line"), logo = q(".logo"), c = chs(q(".txt"));
      tl.to(c, { x: -60, opacity: 0, duration: .3, ease: "power3.in", stagger: stgEnd(c.length, .22, .01) }, 0)
        .to(logo, { scale: 0, rotation: 20, duration: .32, ease: "back.in(2)" }, .2)
        .to(ln, { scaleX: 0, duration: .5, ease: "power3.inOut" }, .28)
        .to(bg, { clipPath: "inset(0 100% 0 0)", duration: .5, ease: "power3.inOut" }, .3);
    }
  };

  /* ---------------- v1 · 4 · Partner + scan code ---------------- */
  D.partner = {
    fit: [[".ln", 1440]],
    id: "ch-partner-scan", name: "Partner + Scan Code", tech: "Live scan code with a sweeping scan line and three lines of giving details",
    category: "general", tags: ["Church", "Graphics", "Giving", "Partner", "Motion", "Animated"], color: "#f2b632", H: 480, hold: 10,
    fields: [text("line1", "Line 1 (heading)", "Partner with us |"), text("line2", "Line 2", "Go to: yourchurchname.com/partner"),
      text("line3", "Line 3", "Or click the donate button to the right"), text("scanLink", "Scan link (where the code opens)", "https://yourchurchname.com/partner"),
      color("colAccent", "Accent colour", "#f2b632", "c1")],
    bind: { line1: "l1", line2: "l2", line3: "l3" },
    init: function (sec, P) {
      var box = $(".code", sec);
      if (!box || !QR) return;
      try {
        var q = QR(0, "M"); q.addData(qrText(P.scanLink)); q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 1, margin: 0, scalable: true });
        var s = $("svg", box); if (s) { s.removeAttribute("width"); s.removeAttribute("height"); }
      } catch (e) { /* invalid data: leave the white tile */ }
    },
    in: function (tl, q, qa) {
      var sc = q(".scrim"), qr = q(".qr"), scan = q(".scan"), rule = q(".rule"), ln = qa(".lines .ln");
      tl.fromTo(sc, { opacity: 0 }, { opacity: 1, duration: .9, ease: "power2.out" }, 0)
        .fromTo(qr, { clipPath: "inset(100% 0 0 0)", scale: .92 }, { clipPath: "inset(0% 0 0 0)", scale: 1, duration: .7, ease: "expo.out" }, .05)
        .fromTo(scan, { y: 0, opacity: 1 }, { y: 150, duration: .55, ease: "sine.inOut", yoyo: true, repeat: 1 }, .5)
        .to(scan, { opacity: 0, duration: .2 }, 1.55)
        .fromTo(rule, { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: .6, ease: "expo.out" }, .3)
        .fromTo(ln, { yPercent: 125 }, { yPercent: 0, duration: .7, ease: "expo.out", stagger: .12 }, .42);
    },
    out: function (tl, q, qa) {
      var sc = q(".scrim"), qr = q(".qr"), rule = q(".rule"), ln = qa(".lines .ln");
      tl.to(ln, { yPercent: -125, duration: .36, ease: "power3.in", stagger: { each: .07, from: "end" } }, 0)
        .to(rule, { scaleY: 0, transformOrigin: "50% 0", duration: .4, ease: "power3.in" }, .2)
        .to(qr, { clipPath: "inset(0 0 100% 0)", duration: .45, ease: "power3.inOut" }, .28)
        .to(sc, { opacity: 0, duration: .5, ease: "power2.in" }, .3);
    }
  };

  /* ---------------- v1 · 5 · Moment + timer ---------------- */
  D.honour = {
    fit: [[".title [data-f]", 1300], [".serif", 1660], [".tags", 1660]],
    id: "ch-moment-timer", name: "Moment + Timer", tech: "Live clock, countdown or count-up timer with a title bar and a serif tagline for honour, testimony or prayer moments",
    category: "general", tags: ["Church", "Graphics", "Announcement", "Clock", "Motion", "Animated"], color: "#f6bba5", H: 300, hold: 0,
    fields: [select("timerMode", "Show", "clock", [{ label: "Live clock", value: "clock" }, { label: "Countdown timer", value: "down" }, { label: "Count-up timer", value: "up" }]),
      text("timerLength", "Timer length (min:sec)", "05:00"),
      select("clockPeriod", "AM/PM display (clock only)", "ampm", [{ label: "Show AM/PM", value: "ampm" }, { label: "Hide AM/PM", value: "hidden" }]),
      text("heading", "Heading", "Your heading here"), text("tagline", "Tagline", "Share Your Memories On Social Media"),
      text("handles", "Hashtags / handles", "#YourHashtag @YourChurch"),
      color("colTimerBg", "Timer box colour", "#000000", "c2"), color("colTimerText", "Timer text colour", "#ffffff", "c3"),
      color("colHeadingBg", "Heading bar colour", "#ffffff", "c4"), color("colHeadingText", "Heading text colour", "#000000", "c5"),
      color("colTagline", "Tagline bar colour", "#f6bba5", "c1"), color("colTaglineText", "Tagline text colour", "#2a1a16", "c6")],
    bind: { heading: "title", tagline: "line", handles: "tags" },
    init: function (sec, P, ctx) {
      var box = $(".time", sec), el = $(".tm", sec), showPeriod = P.clockPeriod !== "hidden";
      box.style.minWidth = "250px";
      box.style.whiteSpace = "nowrap";
      var mode = P.timerMode === "down" || P.timerMode === "up" ? P.timerMode : "clock";
      function parseLen(v) {
        var parts = String(v == null ? "" : v).trim().split(":").map(function (n) { return parseInt(n, 10); });
        if (!parts.length || parts.some(function (n) { return isNaN(n) || n < 0; })) return 300;
        var total = parts.length === 1 ? parts[0] * 60 : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
        return total > 0 ? total : 300;
      }
      function fmt(total) {
        var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
        var ss = String(s).padStart(2, "0");
        return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss;
      }
      var length = parseLen(P.timerLength), started = Date.now();
      function tick() {
        if (mode === "clock") {
          var now = new Date(), hour24 = now.getHours(), hour12 = hour24 % 12 || 12;
          var time = String(hour12) + ":" + String(now.getMinutes()).padStart(2, "0");
          el.textContent = showPeriod ? time + (hour24 < 12 ? " AM" : " PM") : time;
          return;
        }
        var elapsed = Math.floor((Date.now() - started) / 1000);
        el.textContent = fmt(mode === "down" ? Math.max(0, length - elapsed) : elapsed);
      }
      tick();
      ctx.interval = setInterval(tick, 250);
    },
    in: function (tl, q, qa, ctx) {
      var tm = q(".time"), ti = q(".title"), r2 = q(".r2"), tmt = q(".tm"), tc = chs(q(".title [data-f]")), sf = q(".serif"), tg = q(".tags");
      tl.fromTo(tm, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", duration: .6, ease: "expo.out" }, 0)
        .fromTo(ti, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .8, ease: "expo.out" }, .12)
        .fromTo(r2, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .9, ease: "expo.out" }, .3)
        .fromTo(tmt, { yPercent: 125 }, { yPercent: 0, duration: .5, ease: "expo.out" }, .25)
        .fromTo(tc, { yPercent: 125 }, { yPercent: 0, duration: .6, ease: "expo.out", stagger: stg(tc.length, .35, .02) }, .38)
        .fromTo(sf, { yPercent: 125 }, { yPercent: 0, duration: .7, ease: "expo.out" }, .55)
        .fromTo(tg, { yPercent: 125 }, { yPercent: 0, duration: .6, ease: "expo.out" }, .68);
    },
    out: function (tl, q) {
      var tm = q(".time"), ti = q(".title"), r2 = q(".r2"), tmt = q(".tm"), tc = chs(q(".title [data-f]")), sf = q(".serif"), tg = q(".tags");
      tl.to(tg, { yPercent: -125, duration: .3, ease: "power3.in" }, 0)
        .to(sf, { yPercent: -125, duration: .34, ease: "power3.in" }, .06)
        .to(r2, { clipPath: "inset(0 100% 0 0)", duration: .5, ease: "power3.inOut" }, .2)
        .to(tc, { yPercent: -125, duration: .3, ease: "power3.in", stagger: stgEnd(tc.length, .15, .01) }, .22)
        .to(ti, { clipPath: "inset(0 100% 0 0)", duration: .5, ease: "power3.inOut" }, .38)
        .to(tmt, { yPercent: -125, duration: .3, ease: "power3.in" }, .4)
        .to(tm, { clipPath: "inset(100% 0 0 0)", duration: .45, ease: "power3.inOut" }, .5);
    }
  };

  /* ---------------- v1 · 6 · Ways to give (blue panel) ---------------- */
  D.give = {
    box: ".box", // a boxed graphic: Position left / centre / right moves this box
    fit: [[".ttl", 560], [".rw span[data-f]", 760]],
    id: "ch-give-blue", name: "Ways to Give — Blue Panel", tech: "Blue bordered panel with a big title, divider and three icon rows with a moving glow",
    category: "general", tags: ["Church", "Graphics", "Giving", "Motion", "Animated"], color: "#2f45f0", H: 312, hold: 10,
    fields: [text("heading", "Heading", "Ways to give"), text("row1", "Line 1 (web)", "yourchurchname.com/give"), text("row2", "Line 2 (text)", "Text any amount to 12345"),
      text("row3", "Line 3 (address)", "123 Main St, City, ST 00000"), color("colBorder", "Border colour", "#2f45f0", "c1"), color("colPanel", "Panel colour", "#0c1458", "c2")],
    bind: { heading: "title", row1: "r1", row2: "r2", row3: "r3" },
    in: function (tl, q, qa) {
      var box = q(".box"), sh = q(".shine"), c = chs(q(".ttl")), dv = q(".div"), rw = qa(".rw"), ic = qa(".ic");
      tl.fromTo(box, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .95, ease: "expo.out" }, 0)
        .fromTo(c, { yPercent: 125 }, { yPercent: 0, duration: .65, ease: "expo.out", stagger: stg(c.length, .35, .03) }, .3)
        .fromTo(dv, { scaleY: 0 }, { scaleY: 1, duration: .6, ease: "expo.out" }, .5)
        .fromTo(rw, { x: -44, opacity: 0 }, { x: 0, opacity: 1, duration: .55, ease: "power3.out", stagger: .11 }, .55)
        .fromTo(ic, { scale: 0 }, { scale: 1, duration: .5, ease: "back.out(2.4)", stagger: .11 }, .62)
        .fromTo(sh, { x: -400 }, { x: box.offsetWidth + 400, duration: 1, ease: "power2.inOut" }, .7);
    },
    out: function (tl, q, qa) {
      var box = q(".box"), c = chs(q(".ttl")), dv = q(".div"), rw = qa(".rw"), ic = qa(".ic");
      tl.to(ic, { scale: 0, duration: .25, ease: "back.in(2)", stagger: { each: .06, from: "end" } }, 0)
        .to(rw, { x: -44, opacity: 0, duration: .3, ease: "power3.in", stagger: { each: .06, from: "end" } }, .02)
        .to(dv, { scaleY: 0, duration: .3, ease: "power3.in" }, .2)
        .to(c, { yPercent: -125, duration: .3, ease: "power3.in", stagger: stgEnd(c.length, .18, .012) }, .2)
        .to(box, { clipPath: "inset(0 100% 0 0)", duration: .55, ease: "power3.inOut" }, .36);
    },
    ambient: function (q) {
      var gl = q(".glow"), box = q(".box");
      return [gsap.fromTo(gl, { x: -200 }, { x: function () { return box.offsetWidth - 300; }, duration: 6, ease: "sine.inOut", yoyo: true, repeat: -1 })];
    }
  };

  /* ---------------- v2 · 1 · Blue HUD ---------------- */
  var V2_GIVE_FIELDS = function (title, accent) {
    var f = [text("heading", "Heading", title), text("subtitle", "Subtitle", "Thank you for your generosity")].concat(itemFields());
    if (accent) f.push(accent);
    return f;
  };
  D.hud = {
    fit: [[".ttl", 610], [".sub", 610], [".it .tx [data-f]", 270]],
    id: "ch-give-hud", name: "Ways to Give — Blue HUD", tech: "Tech frame draws on, the title decodes, three give options power up with chevrons",
    category: "general", tags: ["Church", "Graphics", "Giving", "Motion", "Animated"], color: "#8fe3ff", H: 260, hold: 10,
    fields: V2_GIVE_FIELDS("WAYS TO GIVE", color("colGlow", "Glow colour", "#8fe3ff", "accent")),
    bind: { heading: "title", subtitle: "sub" },
    init: function (sec) {
      var items = $(".items", sec);
      items.innerHTML = [1, 2, 3].map(function (i) {
        return '<div class="it"><span class="ic">' + IC[ICONS[i - 1]] + '</span><div class="tx"><div class="mk"><div data-f="item' + i + 'a"></div></div><div class="mk"><div data-f="item' + i + 'b"></div></div></div></div>';
      }).join("");
    },
    in: function (tl, q, qa) {
      var fT = q(".fT"), fB = q(".fB"), pan = q(".hpanel"), sR = q(".stripR"), cv = qa(".chev path"), its = qa(".it");
      [fT, fB].forEach(function (p) { var L = len(p); tl.fromTo(p, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: .95, ease: "power2.inOut" }, 0); });
      tl.fromTo(pan, { opacity: 0 }, { opacity: 1, duration: .55, ease: flick }, .2)
        .fromTo(sR, { attr: { width: 0 } }, { attr: { width: 1180 }, duration: .75, ease: "expo.out" }, .5);
      scramble(tl, q(".ttl"), .45, .75);
      tl.fromTo(chs(q(".sub")), { opacity: 0 }, { opacity: 1, duration: .02, stagger: .022 }, .75);
      its.forEach(function (it, i) {
        var t = .75 + i * .14;
        tl.fromTo($(".ic", it), { scale: 0, rotation: -60, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: .5, ease: "back.out(2.5)" }, t)
          .fromTo($(".tx", it), { clipPath: "inset(0 100% 0 0)", x: -14 }, { clipPath: "inset(0 0% 0 0)", x: 0, duration: .5, ease: "power3.out" }, t + .08);
      });
      tl.fromTo(cv, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: .4, ease: "power3.out", stagger: .1 }, .95);
    },
    out: function (tl, q, qa) {
      var fT = q(".fT"), fB = q(".fB"), pan = q(".hpanel"), sR = q(".stripR"), cv = qa(".chev path"), its = qa(".it").reverse();
      tl.to(cv, { x: 24, opacity: 0, duration: .25, ease: "power2.in", stagger: { each: .06, from: "end" } }, 0);
      its.forEach(function (it, i) {
        var t = i * .07;
        tl.to($(".tx", it), { clipPath: "inset(0 100% 0 0)", duration: .28, ease: "power3.in" }, t).to($(".ic", it), { scale: 0, opacity: 0, duration: .25, ease: "back.in(2)" }, t + .05);
      });
      scramble(tl, q(".ttl"), .12, .4, true);
      tl.to(chs(q(".sub")), { opacity: 0, duration: .02, stagger: { each: .012, from: "end" } }, .12)
        .to(sR, { attr: { width: 0 }, duration: .45, ease: "power3.in" }, .3)
        .to(pan, { opacity: 0, duration: .35, ease: flickOut }, .5);
      [fT, fB].forEach(function (p) { tl.to(p, { strokeDashoffset: len(p), duration: .5, ease: "power2.in" }, .55); });
    },
    ambient: function (q, qa) {
      var cv = qa(".chev path"), fr = q(".frame"), sc = q(".scan");
      return [gsap.to(cv, { x: 7, duration: .6, ease: "sine.inOut", yoyo: true, repeat: -1, stagger: .15 }),
        gsap.to(fr, { opacity: .75, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: -1 }),
        gsap.fromTo(sc, { attr: { x: -200 } }, { attr: { x: 700 }, duration: 2.2, ease: "power1.inOut", repeat: -1, repeatDelay: 2.5 })];
    }
  };

  /* ---------------- v2 · 2 · Fire ---------------- */
  D.fire = {
    fit: [[".tbox .t", 490], [".sub [data-f]", 524], [".col .l", colW]],
    id: "ch-give-fire", name: "Ways to Give — Fire", tech: "Black band with a living fire edge, white title box and three give options",
    category: "general", tags: ["Church", "Graphics", "Giving", "Motion", "Animated"], color: "#ff5a14", H: 300, hold: 10,
    fields: V2_GIVE_FIELDS("WAYS TO GIVE", color("colFire", "Fire edge colour", "#ff5a14", "accent")),
    bind: { heading: "title", subtitle: "sub" },
    init: function (sec) { fillCols(sec); },
    in: function (tl, q) {
      var band = q(".band"), fa = q(".fa"), edge = q(".edge"), box = q(".tbox"), c = chs(q(".t")), sub = q(".sub .mk>div"), pan = q(".fpanel");
      tl.fromTo(band, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", duration: .7, ease: "expo.out" }, 0)
        .fromTo(fa, { opacity: 0, filter: "brightness(2.4)" }, { opacity: 1, filter: "brightness(1)", duration: 1.1, ease: "power2.out" }, .1)
        .fromTo(edge, { scaleX: 0 }, { scaleX: 1, duration: .8, ease: "expo.out" }, .05)
        .fromTo(box, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .6, ease: "expo.out" }, .3)
        .fromTo(c, { yPercent: 115 }, { yPercent: 0, duration: .6, ease: "expo.out", stagger: stg(c.length, .3, .025) }, .45)
        .fromTo(sub, { yPercent: 120 }, { yPercent: 0, duration: .55, ease: "expo.out" }, .7)
        .fromTo(pan, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .75, ease: "expo.out" }, .42);
      colsIn(tl, pan, .75);
    },
    out: function (tl, q) {
      var band = q(".band"), edge = q(".edge"), box = q(".tbox"), c = chs(q(".t")), sub = q(".sub .mk>div"), pan = q(".fpanel");
      colsOut(tl, pan, 0);
      tl.to(pan, { clipPath: "inset(0 100% 0 0)", duration: .45, ease: "power3.inOut" }, .3)
        .to(sub, { yPercent: -120, duration: .28, ease: "power3.in" }, .1)
        .to(c, { yPercent: -115, duration: .3, ease: "power3.in", stagger: stgEnd(c.length, .15, .015) }, .15)
        .to(box, { clipPath: "inset(0 100% 0 0)", duration: .4, ease: "power3.inOut" }, .38)
        .to(edge, { scaleX: 0, duration: .4, ease: "power3.in" }, .55)
        .to(band, { clipPath: "inset(100% 0 0 0)", duration: .45, ease: "power3.in" }, .6);
    },
    ambient: function (q) {
      var fb = q(".fb"), fa = q(".fa");
      return [gsap.fromTo(fb, { x: 0 }, { x: -640, duration: 9, ease: "none", repeat: -1 }),
        gsap.to(fa, { opacity: .78, duration: .18, ease: "none", repeat: -1, yoyo: true, repeatRefresh: true,
          onRepeat: function () { this.vars.duration = .1 + Math.random() * .25; } })];
    }
  };

  /* ---------------- v2 · 3 · Navy paper ---------------- */
  D.navy = {
    fit: [[".ttl", 590], [".sub [data-f]", 560], [".col .l", colW]],
    id: "ch-give-navy", name: "Ways to Give — Navy Paper", tech: "Torn-paper navy band rises, gold blackletter title wipes on",
    category: "general", tags: ["Church", "Graphics", "Giving", "Motion", "Animated"], color: "#1e3366", H: 290, hold: 10,
    fields: V2_GIVE_FIELDS("Ways To Give"),
    bind: { heading: "title", subtitle: "sub" },
    init: function (sec) {
      fillCols(sec);
      /* torn paper edge (seeded, so it is the same every time) */
      var s = 11; function r() { s = (s * 16807) % 2147483647; return s / 2147483647; }
      var pts = []; for (var x = 0; x <= 1920; x += 14 + r() * 22) pts.push(x.toFixed(0) + "px " + (r() * 16 + (r() < .15 ? 8 : 0)).toFixed(0) + "px");
      pts.push("1920px 6px");
      $(".band", sec).style.clipPath = "polygon(" + pts.join(",") + ",100% 100%,0 100%)";
      var p2 = []; for (var y = 0; y <= 130; y += 8 + r() * 10) p2.push(y.toFixed(0) + "px " + (48 + r() * 12).toFixed(0) + "px");
      $(".patch", sec).style.clipPath = "polygon(0 0,100% 0,100% 100%," + p2.reverse().join(",") + ")";
    },
    in: function (tl, q) {
      var band = q(".band"), t = q(".ttl"), sub = q(".sub .mk>div");
      tl.fromTo(band, { yPercent: 105 }, { yPercent: 0, duration: .8, ease: "expo.out" }, 0)
        .fromTo(t, { "--p": 0, "--q": -10, filter: "blur(3px)" }, { "--p": 110, filter: "blur(0px)", duration: 1, ease: "power2.inOut" }, .35)
        .fromTo(sub, { yPercent: 120 }, { yPercent: 0, duration: .55, ease: "expo.out" }, .85);
      colsIn(tl, q(".cols"), .6);
    },
    out: function (tl, q) {
      var band = q(".band"), t = q(".ttl"), sub = q(".sub .mk>div");
      colsOut(tl, q(".cols"), 0);
      tl.to(sub, { yPercent: -120, duration: .28, ease: "power3.in" }, .1)
        .to(t, { "--q": 110, duration: .5, ease: "power2.in" }, .15)
        .to(band, { yPercent: 105, duration: .5, ease: "power3.in" }, .45);
    }
  };

  /* ---------------- v2 · 4 · Pastor name ---------------- */
  D.pastor = {
    fit: [[".name [data-f]", 1650], [".pill .r", 620]],
    id: "ch-pastor-streak", name: "Pastor Name — Black Streak", tech: "Black textured band with a light streak, big name and a silver role pill",
    category: "speaker", tags: ["Church", "Graphics", "Speaker", "Pastor", "Name", "Motion", "Animated"], color: "#c9c9c9", H: 270, hold: 6,
    fields: [text("name", "Name", "Pastor's Name"), text("role", "Role", "Lead Pastor")],
    bind: { name: "name", role: "role" },
    in: function (tl, q) {
      var band = q(".band"), st = q(".streak"), c = chs(q(".name [data-f]")), pill = q(".pill"), r = q(".pill .r"), b1 = q(".b1"), b2 = q(".b2"), tg = q(".tog");
      tl.fromTo(band, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .8, ease: "expo.out" }, 0)
        .fromTo(st, { x: -400 }, { x: 2300, duration: 1.1, ease: "power2.inOut" }, .15)
        .fromTo(c, { yPercent: 115 }, { yPercent: 0, duration: .65, ease: "expo.out", stagger: stg(c.length, .35, .025) }, .3)
        .fromTo(pill, { clipPath: "inset(0 100% 0 0 round 33px)" }, { clipPath: "inset(0 0% 0 0 round 33px)", duration: .7, ease: "expo.out" }, .5)
        .fromTo(r, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: .5, ease: "power3.out" }, .7)
        .fromTo(b1, { x: -18, y: 18, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: .4, ease: "back.out(2)" }, .75)
        .fromTo(b2, { x: -18, y: -18, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: .4, ease: "back.out(2)" }, .8)
        .fromTo(tg, { opacity: 0 }, { opacity: 1, duration: .3, ease: flick }, .9);
    },
    out: function (tl, q) {
      var band = q(".band"), c = chs(q(".name [data-f]")), pill = q(".pill"), r = q(".pill .r"), b1 = q(".b1"), b2 = q(".b2"), tg = q(".tog");
      tl.to([b1, b2, tg], { opacity: 0, duration: .2, ease: "power2.in" }, 0)
        .to(r, { x: -30, opacity: 0, duration: .25, ease: "power3.in" }, 0)
        .to(pill, { clipPath: "inset(0 100% 0 0 round 33px)", duration: .4, ease: "power3.inOut" }, .1)
        .to(c, { yPercent: -115, duration: .3, ease: "power3.in", stagger: stgEnd(c.length, .15, .012) }, .1)
        .to(band, { clipPath: "inset(0 100% 0 0)", duration: .5, ease: "power3.inOut" }, .35);
    },
    ambient: function (q) { return [gsap.fromTo(q(".tex"), { x: 0 }, { x: 180, duration: 14, ease: "none", repeat: -1, yoyo: true })]; }
  };

  /* ======================================================================
   * Runtime: styles, fonts, and the adapter to the Motion engine contract
   * ==================================================================== */
  var FONT_FACES = [
    ["Anton", 400, "anton-400.woff2"], ["Saira", 800, "saira-800.woff2"], ["Saira Semi Condensed", 700, "saira-semi-condensed-700.woff2"],
    ["Grenze Gotisch", 700, "grenze-gotisch-700.woff2"], ["Kaushan Script", 400, "kaushan-script-400.woff2"]
  ];
  function injectStyles() {
    if (typeof document === "undefined" || document.getElementById("mce-church-lt-style")) return;
    var faces = FONT_FACES.map(function (f) {
      return "@font-face{font-family:'" + f[0] + "';font-weight:" + f[1] + ";font-style:normal;font-display:block;src:url(/fonts/church/" + f[2] + ") format('woff2')}";
    }).join("\n");
    var st = document.createElement("style");
    st.id = "mce-church-lt-style";
    st.textContent = faces + "\n" + CSS;
    (document.head || document.documentElement).appendChild(st);
    // Montserrat, Bebas Neue and Playfair Display come from the app's bundled Google fonts.
    if (!document.querySelector('link[href*="/fonts/google/google-fonts.css"]')) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/fonts/google/google-fonts.css";
      (document.head || document.documentElement).appendChild(l);
    }
    // Start font downloads now so the first "Send to OBS" never waits on them.
    if (document.fonts && document.fonts.load) {
      FONT_FACES.forEach(function (f) { document.fonts.load(f[1] + " 40px '" + f[0] + "'").catch(function () { }); });
      ["800 40px Montserrat", "600 40px Montserrat", "400 40px 'Bebas Neue'", "500 40px 'Playfair Display'"].forEach(function (s) { document.fonts.load(s).catch(function () { }); });
    }
  }

  /* Ambient loops and timers belong to one build; stop them once its DOM is gone. */
  var live = [];
  var sweeper = 0;
  function killAmb(ctx) {
    (ctx.amb || []).forEach(function (a) { a.kill(); });
    ctx.amb = [];
  }
  function stopCtx(ctx) {
    killAmb(ctx);
    if (ctx.interval) { clearInterval(ctx.interval); ctx.interval = 0; }
  }
  function track(ctx) {
    live.push(ctx);
    if (!sweeper) sweeper = setInterval(function () {
      live = live.filter(function (c) { if (c.sec.isConnected) return true; stopCtx(c); return false; });
      if (!live.length) { clearInterval(sweeper); sweeper = 0; }
    }, 1000);
  }

  /* Offset of an element inside the section, in 1920px design pixels (transform-free). */
  function designRect(el, sec) {
    var x = 0, y = 0, n = el;
    while (n && n !== sec) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, w: el.offsetWidth };
  }
  var EDGE = 96; // the designs' own side margin

  function justifyFactor(kx) {
    var j = kx && kx.style ? kx.style.justifyContent : "";
    return j === "center" ? .5 : j === "flex-end" ? 1 : 0;
  }

  function makeTemplate(key) {
    var d = D[key];
    var markup = MARKUP[key];
    return {
      id: d.id, name: d.name, ref: "Church graphics", tech: d.tech, color: d.color, family: "church",
      category: d.category, tags: d.tags, hold: d.hold, fields: d.fields,
      build: function (stage, P, c) {
        injectStyles();
        var kx = stage.parentElement;
        var inOverlay = !!(kx && kx.closest && kx.closest("#overlay-root"));
        var S = c.scale || 1;
        if (kx) { kx.style.padding = "0"; kx.style.lineHeight = "normal"; }
        if (!inOverlay && kx && kx.parentElement) {
          // Previews: shrink the full 1920px design to the preview canvas.
          var pw = kx.parentElement.clientWidth || DESIGN_W;
          S = S * Math.min(1, pw / DESIGN_W);
        }
        var H = d.H;
        // In OBS the strap is pinned to the screen: a zero-width anchor at the position the
        // Dock picked (left / centre / right), and the 1920px design is laid out from it, so
        // full-width bands always run edge to edge and keep their designed placement.
        var crop = document.createElement("div");
        crop.style.cssText = "position:relative;overflow:visible;width:" + (inOverlay ? 0 : Math.round(DESIGN_W * S)) + "px;height:" + Math.round(H * S) + "px";
        var frame = document.createElement("div");
        var left = inOverlay ? -DESIGN_W * S * justifyFactor(kx) : 0;
        frame.style.cssText = "position:absolute;left:" + left + "px;top:0;width:" + DESIGN_W + "px;height:" + DESIGN_H + "px;transform-origin:0 0;transform:scale(" + S + ") translateY(" + (-(DESIGN_H - H)) + "px)";
        var uid = "c" + (++uidSeq);
        var sec = document.createElement("section");
        sec.className = "clt clt-v" + (VER[key]) + " clt-" + key;
        sec.innerHTML = markup.replace(/__UID__/g, uid);
        frame.appendChild(sec); crop.appendChild(frame); stage.appendChild(crop);

        var ctx = { sec: sec, amb: [], interval: 0, timerReset: function () { } };
        // colours
        d.fields.forEach(function (f) {
          if (f[4] === "color" && f[6]) sec.style.setProperty("--" + f[6], hex(P[f[0]], f[3]));
        });
        if (d.init) d.init(sec, P, ctx);
        // text: data-f attributes use the original builder names (see `bind`), item fields use their own key
        d.fields.forEach(function (f) {
          if (f[4] !== "text") return;
          var attr = (d.bind && d.bind[f[0]]) || f[0];
          $$('[data-f="' + attr + '"]', sec).forEach(function (el) { setText(el, P[f[0]]); });
        });
        fitText(sec, d.fit);
        // Boxed graphics follow the Dock's Position (left / centre / right) with the designs'
        // 96px margin; full-width bands are pinned edge to edge.
        if (inOverlay && d.box) {
          var boxEl = $(d.box, sec);
          if (boxEl) {
            var r = designRect(boxEl, sec), f = justifyFactor(kx);
            var target = f === 0 ? EDGE * S : f === 1 ? DESIGN_W - EDGE * S - r.w * S : (DESIGN_W - r.w * S) / 2;
            frame.style.left = (target - DESIGN_W * f - r.x * S) + "px";
          }
        }

        var q = function (s) { return $(s, sec); }, qa = function (s) { return $$(s, sec); };
        var tin = gsap.timeline(), tout = gsap.timeline();
        d.in(tin, q, qa, ctx);
        if (d.ambient) tin.call(function () { killAmb(ctx); ctx.amb = d.ambient(q, qa) || []; }, null, tin.duration());
        tout.call(function () { killAmb(ctx); }, null, 0);
        d.out(tout, q, qa, ctx);
        tout.set(sec, { autoAlpha: 0 }, tout.duration() + .02);
        track(ctx);
        return { tin: tin, tout: tout };
      }
    };
  }

  injectStyles();
  api.register(["prayer", "egroup", "text", "partner", "honour", "give", "hud", "fire", "navy", "pastor"].map(makeTemplate));

})(typeof window !== "undefined" ? window : globalThis);
