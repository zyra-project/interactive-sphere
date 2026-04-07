import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const publicDir = join(import.meta.dirname, '..', 'public');

// Globe icon as SVG - earth-like sphere with meridians and parallels
const svgIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="sphere" cx="40%" cy="35%" r="50%">
      <stop offset="0%" stop-color="#4FC3F7"/>
      <stop offset="60%" stop-color="#1565C0"/>
      <stop offset="100%" stop-color="#0D2137"/>
    </radialGradient>
    <radialGradient id="shine" cx="35%" cy="30%" r="45%">
      <stop offset="0%" stop-color="white" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip">
      <circle cx="${size/2}" cy="${size/2}" r="${size*0.44}"/>
    </clipPath>
  </defs>
  <!-- Background circle -->
  <circle cx="${size/2}" cy="${size/2}" r="${size*0.46}" fill="#0a1628"/>
  <!-- Globe body -->
  <circle cx="${size/2}" cy="${size/2}" r="${size*0.44}" fill="url(#sphere)"/>
  <!-- Grid lines (meridians & parallels) -->
  <g clip-path="url(#clip)" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="${Math.max(1, size*0.012)}">
    <!-- Equator -->
    <ellipse cx="${size/2}" cy="${size/2}" rx="${size*0.44}" ry="${size*0.06}"/>
    <!-- Parallels -->
    <ellipse cx="${size/2}" cy="${size*0.33}" rx="${size*0.35}" ry="${size*0.05}"/>
    <ellipse cx="${size/2}" cy="${size*0.67}" rx="${size*0.35}" ry="${size*0.05}"/>
    <!-- Central meridian -->
    <ellipse cx="${size/2}" cy="${size/2}" rx="${size*0.06}" ry="${size*0.44}"/>
    <!-- Side meridians -->
    <ellipse cx="${size*0.37}" cy="${size/2}" rx="${size*0.04}" ry="${size*0.42}"/>
    <ellipse cx="${size*0.63}" cy="${size/2}" rx="${size*0.04}" ry="${size*0.42}"/>
  </g>
  <!-- Simplified land masses -->
  <g clip-path="url(#clip)" fill="rgba(76,175,80,0.5)" stroke="none">
    <!-- Americas-like shape -->
    <path d="M${size*0.38} ${size*0.22} Q${size*0.42} ${size*0.25} ${size*0.40} ${size*0.32} Q${size*0.36} ${size*0.36} ${size*0.38} ${size*0.40} Q${size*0.42} ${size*0.48} ${size*0.38} ${size*0.55} Q${size*0.35} ${size*0.62} ${size*0.37} ${size*0.70} Q${size*0.35} ${size*0.65} ${size*0.33} ${size*0.58} Q${size*0.32} ${size*0.50} ${size*0.34} ${size*0.42} Q${size*0.33} ${size*0.35} ${size*0.35} ${size*0.28} Z"/>
    <!-- Europe/Africa-like shape -->
    <path d="M${size*0.52} ${size*0.25} Q${size*0.56} ${size*0.28} ${size*0.58} ${size*0.34} Q${size*0.60} ${size*0.40} ${size*0.57} ${size*0.48} Q${size*0.55} ${size*0.55} ${size*0.56} ${size*0.62} Q${size*0.54} ${size*0.58} ${size*0.53} ${size*0.50} Q${size*0.52} ${size*0.42} ${size*0.54} ${size*0.34} Q${size*0.52} ${size*0.30} ${size*0.50} ${size*0.27} Z"/>
  </g>
  <!-- Specular highlight -->
  <circle cx="${size/2}" cy="${size/2}" r="${size*0.44}" fill="url(#shine)"/>
  <!-- Outer ring -->
  <circle cx="${size/2}" cy="${size/2}" r="${size*0.44}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="${Math.max(1, size*0.015)}"/>
</svg>`;

// Generate PNG icons at various sizes
const sizes = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-16.png', size: 16 },
];

for (const { name, size } of sizes) {
  const buf = Buffer.from(svgIcon(size));
  const png = await sharp(buf).png().toBuffer();
  writeFileSync(join(publicDir, name), png);
  console.log(`Generated ${name} (${size}x${size})`);
}

// Also save the SVG favicon
writeFileSync(join(publicDir, 'favicon.svg'), svgIcon(32));
console.log('Generated favicon.svg');

console.log('Done!');
