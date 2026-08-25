const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  const c = createCanvas(100, 100);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = 'black';
  ctx.fillRect(10, 10, 20, 20);
  const id = ctx.getImageData(0, 0, 100, 100);
  console.log('pixel (0,0):', id.data[0], id.data[1], id.data[2]);
  console.log('pixel (15,15):', id.data[(15 * 100 + 15) * 4], id.data[(15 * 100 + 15) * 4 + 1], id.data[(15 * 100 + 15) * 4 + 2]);
  console.log('todos ceros?', id.data.every((v) => v === 0));

  const png = c.toBuffer('image/png');
  const img = await loadImage(png);
  const c2 = createCanvas(100, 100);
  const ctx2 = c2.getContext('2d');
  ctx2.drawImage(img, 0, 0, 100, 100);
  const id2 = ctx2.getImageData(0, 0, 100, 100);
  console.log('via loadImage pixel (0,0):', id2.data[0], id2.data[1], id2.data[2]);
  console.log('via loadImage pixel (15,15):', id2.data[(15 * 100 + 15) * 4], id2.data[(15 * 100 + 15) * 4 + 1], id2.data[(15 * 100 + 15) * 4 + 2]);
  process.exit(0);
})();
