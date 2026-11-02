export const CAROUSEL_BEARING = {
  id: 'carousel_bearing', qdf: 'carousel_bearing', code: 'UCF209',
  name: '旋转轴承', name_en: 'Rotary bearing', name_de: 'Drehlager',
  buildable: true, compat: true, price: 0,
  width: 13.7, height: 13.7, depth: 5.22, bore: 4.5, boltSpacing: 10.5, boltHole: 1.6,
  fixedColor: '#526b4c', verifiedLoad: false, qdfSupported: false,
  url: 'https://koyo.jtekt.co.jp/en/products/detail/?pno=UCF209',
};

// 局部+X由接头指向轴承背面；单位cm。安装深度为建模参数，未作实物配合验证。
export const CAROUSEL_BEARING_BACK = 7.72;
