/** Pixel-space, centred image crop used by the offline image editor. */
export type CropRect = { originX:number; originY:number; width:number; height:number };
export type AspectPreset = 'original' | 'square' | 'portrait' | 'vertical';
export function cropRect(width:number,height:number,preset:AspectPreset):CropRect | null {
  if (!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) return null;
  if (preset==='original') return { originX:0, originY:0, width:Math.floor(width), height:Math.floor(height) };
  const ratio = preset==='square' ? 1 : preset==='portrait' ? 4/5 : 9/16;
  const actual=width/height;
  const targetWidth = Math.floor(actual>ratio ? height*ratio : width);
  const targetHeight = Math.floor(actual>ratio ? height : width/ratio);
  return {
    originX: Math.floor((width-targetWidth)/2),
    originY: Math.floor((height-targetHeight)/2),
    width:targetWidth, height:targetHeight,
  };
}
