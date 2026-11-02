import { rotateCarouselBearing } from './carouselBearingModel.js';

/** 每次从手势起点计算，避免连续拖动积累取整误差。 */
export class CarouselRotationGesture {
  constructor(model, id, x, y, point, pointOnPlane) {
    this.model = model;
    this.id = id;
    this.before = JSON.stringify(model.toJSON());
    const f = model.fittings.get(id);
    this.origin = [f.x, point?.y ?? f.y, f.z];
    this.pointOnPlane = pointOnPlane;
    this.startX = x;
    this.angle = 0;
    this.lastValid = 0;
    const hit = pointOnPlane(x, y, this.origin, [0, 1, 0]);
    this.radial = hit && Math.hypot(hit.x - f.x, hit.z - f.z) > 3;
    this.previous = this.radial ? Math.atan2(hit.z - f.z, hit.x - f.x) : 0;
  }

  update(x, y) {
    if (this.radial) {
      const p = this.pointOnPlane(x, y, this.origin, [0, 1, 0]);
      if (!p || Math.hypot(p.x - this.origin[0], p.z - this.origin[2]) < 1) return false;
      const a = Math.atan2(p.z - this.origin[2], p.x - this.origin[0]);
      this.angle += Math.atan2(Math.sin(a - this.previous), Math.cos(a - this.previous));
      this.previous = a;
    } else {
      // 轴线上的竖管没有径向力臂，横向拖动仍能连续操作。
      this.angle = (x - this.startX) * 0.012;
    }
    this.model.loadJSON(JSON.parse(this.before));
    const ok = rotateCarouselBearing(this.model, this.id, this.angle * 2 / Math.PI);
    if (ok) this.lastValid = this.angle;
    else rotateCarouselBearing(this.model, this.id, this.lastValid * 2 / Math.PI);
    return ok;
  }

  cancel() { this.model.loadJSON(JSON.parse(this.before)); }
}
