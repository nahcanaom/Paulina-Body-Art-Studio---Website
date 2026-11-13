const fs = require('node:fs');
const path = require('node:path');

const isDemo = () => process.env.PAULINA_ENV === 'demo' && process.env.NODE_ENV !== 'production';
const media = (file) => '/' + file.split('/').map(encodeURIComponent).join('/');

function catalogue() {
  const root = path.join(__dirname, '../public/assets/catalogue-images/Basic Jewelry ASTM F136 Titanium');
  return fs.readdirSync(root).filter(file => file.endsWith('.png')).map((file, index) => ({
    id: `demo-catalogue-${index}`, name: file.replace(/\s*\(.*$/, ''),
    category: 'Ear', subcategory: 'Helix', material: 'ASTM F136 Titanium',
    price: 600, sizes: ['3mm', '4mm'], isPublished: true,
    imageUrl: media(`assets/catalogue-images/Basic Jewelry ASTM F136 Titanium/${file}`),
    images: [media(`assets/catalogue-images/Basic Jewelry ASTM F136 Titanium/${file}`)]
  }));
}

function gallery() {
  return [
    ['fave1.png', 'Lip piercings', 'Face Piercing'],
    ['piercing1.jpg', 'Curated ear piercing', 'Face Piercing'],
    ['piercing2.jpg', 'Floral ear jewellery', 'Face Piercing'],
    ['piercing3.jpg', 'Navel piercing', 'Body Piercing'],
    ['service3.png', 'Navel jewellery', 'Body Piercing'],
    ['service1.jpg', 'Butterfly and floral tattoo', 'Body Tattoo'],
    ['service2.png', 'Ornamental thigh tattoo', 'Body Tattoo']
  ].map(([file, title, category], index) => ({
    id: `demo-gallery-${index}`, title, category, subcategory: category,
    imageUrl: `/assets/images/${file}`, thumbnailUrl: `/assets/images/${file}`,
    altText: title, isPublished: true, displayOrder: index
  }));
}

function filter(items, category) {
  return category === 'all' ? items : items.filter(item => item.category.toLowerCase().includes(String(category).toLowerCase()));
}

module.exports = { isDemo, catalogue, gallery, filter };
