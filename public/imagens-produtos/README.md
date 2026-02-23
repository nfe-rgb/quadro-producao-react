# Imagens de produtos (hover no Estoque)

Coloque aqui as imagens dos produtos para o acesso Mendes.

## Convenção automática

Sem precisar mexer em código, o sistema tenta carregar a imagem por código do item com estes formatos:

- `/imagens-produtos/CODIGO.jpg`
- `/imagens-produtos/CODIGO.jpeg`
- `/imagens-produtos/CODIGO.png`
- `/imagens-produtos/CODIGO.webp`

Exemplo para item `40123`:

- `public/imagens-produtos/40123.jpg`

## Mapeamento manual (opcional)

Se quiser usar nome de arquivo diferente, edite:

- `src/lib/productImageMap.js`

No objeto `PRODUCT_IMAGE_BY_CODE`, informe:

```js
'40123': '/imagens-produtos/nome-personalizado.jpg'
```
