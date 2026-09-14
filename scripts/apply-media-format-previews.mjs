import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("sc3-media-preview-' + item.format")) {
  console.log('Social media format previews already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Media format preview patch failed: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
`const mediaFormatLabels: Record<MediaFormat, string> = {
  post: 'Post',
  short: 'Short / Reel',
  video: 'Vidéo',
  story: 'Story',
};`,
`const mediaFormatLabels: Record<MediaFormat, string> = {
  post: 'Post',
  short: 'Short / Reel',
  video: 'Vidéo',
  story: 'Story',
};

function mediaFormatRatio(format: MediaFormat) {
  if (format === 'post') return '4:5';
  if (format === 'video') return '16:9';
  return '9:16';
}

function primeVideoPreview(video: HTMLVideoElement) {
  if (!Number.isFinite(video.duration) || video.duration <= 0.4 || video.currentTime > 0.1) return;
  video.currentTime = Math.min(Math.max(video.duration * 0.12, 0.4), 3);
}`,
  'format ratio helper',
);

replaceOnce(
  '<div className="sc3-media-preview">',
  "<div className={'sc3-media-preview sc3-media-preview-' + item.format}>",
  'library preview format class',
);

replaceOnce(
  `{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt={item.title} loading="lazy" /> : <div><Video size={30} /><span>{mediaFormatLabels[item.format]}</span></div>}`,
  `{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt={item.title} loading="lazy" /> : item.mimeType.startsWith('video/') ? <div className="sc3-video-surface"><video src={item.previewUrl} playsInline controls preload="auto" onLoadedMetadata={(event) => primeVideoPreview(event.currentTarget)} aria-label={\`Lire \${item.title}\`} /></div> : <div><Video size={30} /><span>{mediaFormatLabels[item.format]}</span></div>}`,
  'real video preview',
);

replaceOnce(
  '<span className="sc3-format-badge">{mediaFormatLabels[item.format]}</span>',
  '<span className="sc3-format-badge">{mediaFormatLabels[item.format]} · {mediaFormatRatio(item.format)}</span>',
  'ratio badge',
);

replaceOnce(
  `<div className="sc3-dialog-preview">{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt={item.title} /> : <div><Video size={34} /><span>{item.fileName}</span></div>}</div>`,
  `<div className={'sc3-dialog-preview sc3-dialog-preview-' + item.format}>{item.mimeType.startsWith('image/') ? <img src={item.previewUrl} alt={item.title} /> : item.mimeType.startsWith('video/') ? <video src={item.previewUrl} controls playsInline preload="auto" onLoadedMetadata={(event) => primeVideoPreview(event.currentTarget)} aria-label={\`Lire \${item.title}\`} /> : <div><Video size={34} /><span>{item.fileName}</span></div>}</div>`,
  'video player in media dialog',
);

fs.writeFileSync(path, source);
console.log('Social media format previews applied.');
