// 房间编辑器、AI 预览与 Builder 共用；单位为厘米，家具局部外轮廓为 [0, 1]。
export const HOME_STYLE = Object.freeze({ background: '#FFF8F2', gridCell: 25, exposure: 1.28 });

export const furnitureRotation = item => item.rotation ?? ((item.type === 'sofa' || item.type === 'cabinet') && item.d > item.w ? 90 : 0);

export function createHomeVisuals(THREE, RoundedBoxGeometry) {
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  function furniture(type, sideways, rotation = furnitureRotation({ type, d: sideways ? 2 : 1, w: 1 })) {
    const root = new THREE.Group(), shape = new THREE.Group(), materials = new Map();
    root.add(shape);
    function part(color, size, position, radius = 0) {
      if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .83 }));
      const geometry = radius ? new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n / 3))) : new THREE.BoxGeometry(...size);
      const mesh = new THREE.Mesh(geometry, materials.get(color));
      mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; shape.add(mesh);
    }
    const oak = '#b99060', paleOak = '#d4b184', fabric = '#d9b486', cushion = '#eee0c3', green = '#a9bda3';
    if (type === 'sofa') {
      for (const x of [.12, .88]) for (const z of [.13, .87]) part('#795841', [.065, .12, .07], [x, .06, z]);
      part(fabric, [.94, .25, .94], [.5, .235, .5], .045);
      part(fabric, [.96, .66, .15], [.5, .67, .075], .05);
      for (const x of [.06, .94]) part(fabric, [.12, .56, .9], [x, .53, .55], .05);
      for (const x of [.295, .705]) {
        part(cushion, [.395, .16, .72], [x, .44, .59], .055);
        part('#e3ceaa', [.395, .37, .12], [x, .735, .205], .045);
      }
    } else if (type === 'cabinet') {
      for (const x of [.09, .91]) for (const z of [.12, .88]) part('#795841', [.055, .07, .08], [x, .035, z]);
      part(oak, [.93, .84, .035], [.5, .535, .0175]);
      for (const x of [.0175, .9825]) part(oak, [.035, .93, 1], [x, .535, .5]);
      for (const y of [.0925, .9775]) part(oak, [1, .045, 1], [.5, y, .5]);
      for (const x of [.265, .735]) part(paleOak, [.45, .83, .035], [x, .535, .9625], .008);
      for (const x of [.46, .54]) part('#6d563b', [.013, .105, .02], [x, .57, .99]);
    } else if (type === 'bed') {
      for (const x of [.1, .9]) for (const z of [.12, .88]) part('#8e704b', [.07, .16, .07], [x, .08, z]);
      part(oak, [.96, .24, .96], [.5, .24, .52], .015);
      part(paleOak, [1, .84, .055], [.5, .58, .0275], .02);
      part('#f3e8d5', [.94, .26, .91], [.5, .49, .53], .06);
      part(green, [.95, .06, .57], [.5, .64, .715], .022);
      for (const x of [.27, .73]) part('#fff8ea', [.36, .12, .18], [x, .66, .2], .04);
    } else if (type === 'table') {
      part(paleOak, [1, .12, 1], [.5, .94, .5], .025);
      part(oak, [.88, .1, .84], [.5, .83, .5]);
      for (const x of [.1, .9]) for (const z of [.12, .88]) part(oak, [.075, .85, .075], [x, .425, z], .008);
    } else if (type === 'column') {
      part('#d9d1c6', [1, .94, 1], [.5, .505, .5], .01);
      part('#c7baaa', [1, .035, 1], [.5, .0175, .5]);
      part('#e7dfd4', [1, .025, 1], [.5, .9875, .5]);
    } else part('#b8c1b3', [1, 1, 1], [.5, .5, .5], .04);
    shape.rotation.y = rotation * Math.PI / 180;
    shape.position.set(rotation === 180 || rotation === 270 ? 1 : 0, 0, rotation === 90 || rotation === 180 ? 1 : 0);
    return root;
  }

  function zone(item) {
    const group = new THREE.Group(), color = item.kind === 'usable' ? '#1FA85A' : '#dc8b41';
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1, .004, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .23, depthWrite: false }));
    floor.position.set(.5, .002, .5); floor.userData.itemId = item.id; group.add(floor);
    const geometry = new THREE.BoxGeometry(1, 1, 1).translate(.5, .5, .5);
    const volume = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: item.kind === 'usable' ? .13 : .16, depthWrite: false }));
    volume.userData.volume = true; volume.userData.itemId = item.id; group.add(volume);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .65 }));
    edges.userData.volume = true; group.add(edges); return group;
  }

  function roomShell(room) {
    const group = new THREE.Group(); group.name = 'home-room-shell';
    const add = (size, position, color) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .94 }));
      mesh.position.set(...position); mesh.receiveShadow = true; group.add(mesh); return mesh;
    };
    add([room.w + 12, 8, room.d + 12], [room.w / 2, -4, room.d / 2], '#e4d3b7');
    add([room.w + 12, room.h, 6], [room.w / 2, room.h / 2, -3], '#ede5d6').userData.wall = 'z';
    add([6, room.h, room.d], [-3, room.h / 2, room.d / 2], '#e4ddcf').userData.wall = 'x';
    add([room.w, 7, 1], [room.w / 2, 3.5, 1], '#d7c9b2').userData.wall = 'z';
    add([1, 7, room.d], [1, 3.5, room.d / 2], '#d7c9b2').userData.wall = 'x';
    const positions = [];
    for (let x = 0; x <= room.w; x += HOME_STYLE.gridCell) positions.push(x, .15, 0, x, .15, room.d);
    for (let z = 0; z <= room.d; z += HOME_STYLE.gridCell) positions.push(0, .15, z, room.w, .15, z);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#aa9472', transparent: true, opacity: .16 }));
    grid.name = 'home-floor-grid'; group.add(grid); return group;
  }

  function lighting() {
    const group = new THREE.Group(), sun = new THREE.DirectionalLight('#fff0d7', 3.3);
    group.add(new THREE.HemisphereLight('#fff7e5', '#bfc8bc', 2.4));
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0001; sun.shadow.intensity = .8;
    group.add(sun, sun.target); group.userData.sun = sun; return group;
  }

  function fitLighting(light, room, coordinateRoot) {
    // HemisphereLight 以世界位置作为方向；房间的逆平移不能改变天空方向。
    const hemisphere = light.parent.children.find(object => object.isHemisphereLight);
    hemisphere.position.copy(light.parent.worldToLocal(vec(0, 1, 0)));
    hemisphere.updateWorldMatrix(true, false);
    const size = Math.max(room.w, room.d, room.h);
    light.target.position.set(room.w / 2, room.h * .25, room.d / 2);
    light.position.copy(light.target.position).add(vec(size * .6, size * 1.5, size * .9));
    light.target.updateWorldMatrix(true, false); light.updateWorldMatrix(true, false); light.shadow.updateMatrices(light);
    const camera = light.shadow.camera, bounds = new THREE.Box3();
    for (const x of [-10, room.w + 10]) for (const y of [-10, room.h + 10]) for (const z of [-10, room.d + 10]) {
      const point = vec(x, y, z); if (coordinateRoot) coordinateRoot.localToWorld(point);
      bounds.expandByPoint(point.applyMatrix4(camera.matrixWorldInverse));
    }
    camera.left = bounds.min.x - 12; camera.right = bounds.max.x + 12;
    camera.bottom = bounds.min.y - 12; camera.top = bounds.max.y + 12;
    camera.near = Math.max(1, -bounds.max.z - 12); camera.far = -bounds.min.z + 12; camera.updateProjectionMatrix();
    const texel = Math.max(camera.right - camera.left, camera.top - camera.bottom) / light.shadow.mapSize.x;
    light.shadow.normalBias = Math.max(.08, texel * .5); light.shadow.needsUpdate = true;
  }
  return { furniture, zone, roomShell, lighting, fitLighting };
}
