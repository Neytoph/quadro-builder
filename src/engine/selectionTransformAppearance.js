import {BackSide,Color,ConeGeometry,CurvePath,CylinderGeometry,LineCurve3,Mesh,QuadraticBezierCurve3,ShaderMaterial,SphereGeometry,TorusGeometry,TubeGeometry,Vector2,Vector3} from 'three';

const CONTOURS=[{color:'#24332f',width:1.8},{color:'#fffdf8',width:0.8}];

function alignArrow(geometry,axis) {
  if(axis==='X')geometry.rotateZ(-Math.PI/2);
  if(axis==='Z')geometry.rotateX(Math.PI/2);
  return geometry;
}

function replaceGeometry(handle,geometry) {
  handle.geometry.dispose();handle.geometry=geometry;
}

function planeCornerGeometry(axis,picker=false) {
  const inner=0.065,outer=0.17,radius=0.022;
  const path=new CurvePath();
  path.add(new LineCurve3(new Vector3(inner,outer,0),new Vector3(outer-radius,outer,0)));
  path.add(new QuadraticBezierCurve3(new Vector3(outer-radius,outer,0),new Vector3(outer,outer,0),new Vector3(outer,outer-radius,0)));
  path.add(new LineCurve3(new Vector3(outer,outer-radius,0),new Vector3(outer,inner,0)));
  // 拾取沿同一条L形路径稍微加宽，空白中心不再截走对模型的点击。
  const geometry=new TubeGeometry(path,24,picker ? 0.026 : 0.0065,12,false);
  if(axis==='YZ')geometry.rotateY(-Math.PI/2);
  if(axis==='XZ')geometry.rotateX(Math.PI/2);
  return geometry;
}

function refineHandles(gizmo) {
  // 每个方向保留一根完整箭头；负方向仍可通过拖动这根箭头到达。
  for(const group of [gizmo.gizmo.translate,gizmo.picker.translate])for(const handle of [...group.children]){
    if(!['X','Y','Z'].includes(handle.name))continue;
    handle.geometry.computeBoundingBox();
    if(handle.geometry.boundingBox.getCenter(new Vector3()).getComponent('XYZ'.indexOf(handle.name))<0){
      handle.removeFromParent();handle.geometry.dispose();
    }
  }
  for(const handle of gizmo.picker.translate.children){
    if(['XY','YZ','XZ'].includes(handle.name))replaceGeometry(handle,planeCornerGeometry(handle.name,true));
  }
  for(const handle of gizmo.gizmo.translate.children){
    const shape=handle.geometry.parameters;
    if(['X','Y','Z'].includes(handle.name)){
      const geometry=shape.radiusTop===0
        ? new ConeGeometry(0.028,0.09,24).translate(0,0.545,0)
        : new CylinderGeometry(0.0085,0.0085,0.5,16).translate(0,0.25,0);
      replaceGeometry(handle,alignArrow(geometry,handle.name));
    }else if(handle.name==='XYZ'){
      replaceGeometry(handle,new SphereGeometry(0.025,20,12));
      handle.material.color.set('#fffdf8');handle.material.opacity=0.95;
    }else if(['XY','YZ','XZ'].includes(handle.name)){
      replaceGeometry(handle,planeCornerGeometry(handle.name));
      handle.material.opacity=1;
    }
  }
  for(const handle of gizmo.gizmo.rotate.children){
    if(!['X','Y','Z'].includes(handle.name))continue;
    const ring=new TorusGeometry(0.5,0.0065,10,96,Math.PI).rotateY(Math.PI/2).rotateX(Math.PI/2);
    if(handle.name==='Y')ring.rotateZ(-Math.PI/2);
    if(handle.name==='Z')ring.rotateY(Math.PI/2);
    replaceGeometry(handle,ring);
  }
}

// 与 Three.js OutlineEffect 相同的法线外扩方式；以屏幕像素计算边缘宽度。
const vertexShader=`
  uniform vec2 viewport;
  uniform float width;
  void main() {
    vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
    vec4 clip=projectionMatrix*viewPosition;
    vec3 viewNormal=normalize(normalMatrix*normal);
    vec4 adjacent=projectionMatrix*vec4(viewPosition.xyz+viewNormal,1.0);
    vec2 direction=(adjacent.xy/adjacent.w-clip.xy/clip.w)*viewport;
    float lengthSquared=dot(direction,direction);
    if(lengthSquared>0.000001)clip.xy+=direction*inversesqrt(lengthSquared)*width*2.0/viewport*clip.w;
    gl_Position=clip;
  }
`;
const fragmentShader=`
  uniform vec3 color;
  void main() {
    gl_FragColor=vec4(color,1.0);
    #include <colorspace_fragment>
  }
`;

/** 复用 Three.js 原生拖动流程，拾取范围对应保留的正向箭头。 */
export function applySelectionTransformAppearance(control) {
  control.setColors('#ff5b42','#68f05b','#45b9ff','#ffd05a');
  const gizmo=control.getHelper().children.find(child=>child.isTransformControlsGizmo);
  if(!gizmo)throw new Error('TransformControls gizmo is missing');
  refineHandles(gizmo);
  for(const mode of ['translate','rotate'])for(const handle of gizmo.gizmo[mode].children){
    if(!handle.isMesh || !['X','Y','Z','XYZ','XY','YZ','XZ'].includes(handle.name))continue;
    for(const [index,layer] of CONTOURS.entries()){
      const material=new ShaderMaterial({
        vertexShader,fragmentShader,side:BackSide,depthTest:false,depthWrite:false,transparent:true,toneMapped:false,
        uniforms:{color:{value:new Color(layer.color)},width:{value:layer.width},viewport:{value:new Vector2(1,1)}},
      });
      // 根辅助对象统一释放几何／材质；克隆几何避免同一个对象被重复 dispose。
      const contour=new Mesh(handle.geometry.clone(),material);
      contour.name=`selection-transform-contour-${index}`;
      contour.userData.selectionTransformContour=true;
      contour.renderOrder=10000+index;contour.frustumCulled=false;
      contour.raycast=()=>{};
      contour.onBeforeRender=renderer=>{
        renderer.getSize(material.uniforms.viewport.value);
        material.uniforms.width.value=layer.width+(control.axis===handle.name ? 0.35 : 0);
      };
      handle.add(contour);
    }
  }
}
