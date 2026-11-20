import type Phaser from 'phaser';

const activeFlashes = new WeakMap<Phaser.GameObjects.Sprite, () => void>();

function whiteTexture(scene: Phaser.Scene, frame: Phaser.Textures.Frame) {
  const key = '__rollbound_hit_white:' + frame.texture.key + ':' + frame.name;
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, frame.realWidth, frame.realHeight);
    if (!texture) return;
    const ctx = texture.getContext();
    ctx.drawImage(frame.source.image as CanvasImageSource,
      frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
      frame.x, frame.y, frame.cutWidth, frame.cutHeight);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, frame.realWidth, frame.realHeight);
    ctx.globalCompositeOperation = 'source-over';
    texture.refresh();
  }
  return key;
}

/** Briefly flashes a sprite's visible pixels white and fades back to its normal art. */
export function flashHit(sprite: Phaser.GameObjects.Sprite, durationMs = 96) {
  if (!sprite.scene || !sprite.active) return;
  activeFlashes.get(sprite)?.();
  const scene = sprite.scene;
  const key = whiteTexture(scene, sprite.frame);
  if (!key) return;

  const overlay = scene.add.image(sprite.x, sprite.y, key).setDepth(sprite.depth);
  scene.children.moveAbove(overlay, sprite);
  let frame = sprite.frame;
  function followSprite() {
    if (frame !== sprite.frame) {
      frame = sprite.frame;
      const nextKey = whiteTexture(scene, frame);
      if (nextKey) overlay.setTexture(nextKey);
    }
    overlay.setPosition(sprite.x, sprite.y)
      .setOrigin(sprite.originX, sprite.originY)
      .setRotation(sprite.rotation)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setFlip(sprite.flipX, sprite.flipY)
      .setScrollFactor(sprite.scrollFactorX, sprite.scrollFactorY)
      .setVisible(sprite.visible);
  }
  followSprite();

  const tween = scene.tweens.add({
    targets: overlay,
    alpha: 0,
    duration: durationMs,
    ease: 'Cubic.easeIn',
    onUpdate: followSprite,
    onComplete: cleanup
  });
  function cleanup() {
    sprite.off('destroy', cancel);
    activeFlashes.delete(sprite);
    overlay.destroy();
  }
  function cancel() {
    tween.stop();
    cleanup();
  }
  sprite.once('destroy', cancel);
  activeFlashes.set(sprite, cancel);
}
