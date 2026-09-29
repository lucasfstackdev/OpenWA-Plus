# Payload de Webhooks da Kirvano

Documentação: `https://help.kirvano.com/hc/central-de-ajuda/articles/1765385505-configurando-integracao-via-webhook`

## Pix Gerado

```json
{
    "event": "PIX_GENERATED",
    "event_description": "PIX gerado",
    "checkout_id": "Q8J1N6K3",
    "sale_id": "D2RP8RQ7",
    "payment_method": "PIX",
    "total_price": "R$ 169,80",
    "type": "ONE_TIME",
    "status": "PENDING",
    "created_at": "2023-12-18 16:38:17",
    "customer": {
        "name": "João da Silva",
        "document": "23875090127",
        "email": "exemplo@email.com",
        "phone_number": "5511987654321"
    },
    "payment": {
        "method": "PIX",
        "qrcode": "00020201011325br.gov.bcb.pixBADE53BA66C4121804702BR5823KIRVANO PAGAMENTOS LTDA***7213D5D7",
        "qrcode_image": "http://localhost:3030/pix/a21e078e-2636-4a62-b35a-277e5818e9fa",
        "expires_at": "2023-12-18 17:38:17"
    },
    "products": [
        {
            "id": "25d84393-3d74-409c-bff7-17b8ecac6bc7",
            "name": "Mercado de Ações no Brasil",
            "offer_id": "175ca45d-8701-4c58-b360-820831d7ee50",
            "offer_name": "Mercado de Ações no Brasil",
            "description": "Conheça os principais conceitos de renda variável e o funcionamento dos mercados",
            "price": "R$ 119,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/070f0275-3e04-4d82-b064-3a294e0c9c33/cover-1702928297052.jpg",
            "is_order_bump": false
        },
        {
            "id": "ffd24c56-9cda-44b4-9b3c-3bb652afddec",
            "name": "Excel para Investidores",
            "offer_id": "bb9f48eb-c73c-4b08-b467-88c6b11b5b11",
            "offer_name": "Excel para Investidores",
            "description": "O melhor curso para quem quer começar a investir e ainda aprender a gerenciar sua carteira.",
            "price": "R$ 49,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/452e8739-bc51-4895-bb7f-9b27e6b53654/cover-1702928297052.jpg",
            "is_order_bump": true
        }
    ],
    "utm": {
        "src": "google",
        "utm_source": "broadcast",
        "utm_medium": "email",
        "utm_campaign": "register",
        "utm_term": "codes",
        "utm_content": "link"
    }
}
```

## Pix Expirado

```json
{
    "event": "PIX_EXPIRED",
    "event_description": "PIX expirado",
    "checkout_id": "Q8J1N6K3",
    "checkout_url": "http://localhost:3001/recovery/338bb957-30e1-4ad9-abf5-ecc72cb42171",
    "sale_id": "D2RP8RQ7",
    "payment_method": "PIX",
    "total_price": "R$ 169,80",
    "type": "ONE_TIME",
    "status": "CANCELED",
    "created_at": "2023-12-18 16:38:32",
    "customer": {
        "name": "João da Silva",
        "document": "23875090127",
        "email": "exemplo@email.com",
        "phone_number": "5511987654321"
    },
    "payment": {
        "method": "PIX",
        "qrcode": "00020201011325br.gov.bcb.pixBADE53BA66C4121804702BR5823KIRVANO PAGAMENTOS LTDA***7213D5D7",
        "qrcode_image": "http://localhost:3030/pix/7c9003c4-dc59-439e-837e-4a43aa05237f",
        "expires_at": "2023-12-18 17:38:32"
    },
    "products": [
        {
            "id": "d9226c39-92f8-46de-8eff-f88fd1beba71",
            "name": "Mercado de Ações no Brasil",
            "offer_id": "424a8bae-12d5-49c6-8cae-f0ae8086fc41",
            "offer_name": "Mercado de Ações no Brasil",
            "description": "Conheça os principais conceitos de renda variável e o funcionamento dos mercados",
            "price": "R$ 119,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/8eb8640a-2abc-439a-a41e-98a71ea2d6d5/cover-1702928312980.jpg",
            "is_order_bump": false
        },
        {
            "id": "29bb2aba-8192-4b6d-9671-890346272868",
            "name": "Excel para Investidores",
            "offer_id": "b9729b1d-2f86-40ec-b92b-6eeddab4f339",
            "offer_name": "Excel para Investidores",
            "description": "O melhor curso para quem quer começar a investir e ainda aprender a gerenciar sua carteira.",
            "price": "R$ 49,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/c6cf21ea-2170-408c-814c-721b3a3e8646/cover-1702928312980.jpg",
            "is_order_bump": true
        }
    ],
    "utm": {
        "src": "google",
        "utm_source": "broadcast",
        "utm_medium": "email",
        "utm_campaign": "register",
        "utm_term": "codes",
        "utm_content": "link"
    }
}
```

## Compra Aprovada

```json
{
    "event": "SALE_APPROVED",
    "event_description": "Compra aprovada",
    "checkout_id": "Q8J1N6K3",
    "sale_id": "D2RP8RQ7",
    "payment_method": "CREDIT_CARD",
    "total_price": "R$ 169,80",
    "type": "ONE_TIME",
    "status": "APPROVED",
    "created_at": "2023-12-18 16:40:06",
    "customer": {
        "name": "João da Silva",
        "document": "23875090127",
        "email": "exemplo@email.com",
        "phone_number": "5511987654321"
    },
    "payment": {
        "method": "CREDIT_CARD",
        "brand": "visa",
        "installments": 1,
        "finished_at": "2023-12-18 16:40:21"
    },
    "products": [
        {
            "id": "6c5708c9-7ae9-4ba3-aefc-c16029d4e729",
            "name": "Mercado de Ações no Brasil",
            "offer_id": "568de0c1-3d20-45c2-b273-b91be1f7bd58",
            "offer_name": "Mercado de Ações no Brasil",
            "description": "Conheça os principais conceitos de renda variável e o funcionamento dos mercados",
            "price": "R$ 119,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/3e7feeb4-a4db-4454-9275-141244d82283/cover-1702928406873.jpg",
            "is_order_bump": false
        },
        {
            "id": "b1e74f14-6013-4981-a831-d7fc45fa5c10",
            "name": "Excel para Investidores",
            "offer_id": "5b80c3ef-8309-4e63-b8c7-3be3c438c115",
            "offer_name": "Excel para Investidores",
            "description": "O melhor curso para quem quer começar a investir e ainda aprender a gerenciar sua carteira.",
            "price": "R$ 49,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/b22a2474-f275-4640-a71d-1d61ffda22d8/cover-1702928406873.jpg",
            "is_order_bump": true
        }
    ],
    "utm": {
        "src": "google",
        "utm_source": "broadcast",
        "utm_medium": "email",
        "utm_campaign": "register",
        "utm_term": "codes",
        "utm_content": "link"
    }
}
```

## Carrinho Abandonado

```json
{
    "event": "ABANDONED_CART",
    "event_description": "Carrinho abandonado",
    "checkout_id": "Q8J1N6K3",
    "checkout_url": "http://localhost:3001/recovery/5280b33c-13f2-492e-bb9c-9d8306e7f3cd",
    "total_price": "R$ 169,80",
    "type": "ONE_TIME",
    "status": "ABANDONED_CART",
    "created_at": "2023-12-18 16:39:37",
    "customer": {
        "name": "João da Silva",
        "document": "23875090127",
        "email": "exemplo@email.com",
        "phone_number": "5511987654321"
    },
    "products": [
        {
            "id": "7cf4513e-e51c-4688-ad80-2773e441a152",
            "name": "Mercado de Ações no Brasil",
            "offer_id": "ed8c6d26-74ae-445e-bed8-a1c92bedbd6e",
            "offer_name": "Mercado de Ações no Brasil",
            "description": "Conheça os principais conceitos de renda variável e o funcionamento dos mercados",
            "price": "R$ 119,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/d5b1cb07-7d4c-4be2-99c5-f92f2bb9082f/cover-1702928377360.jpg",
            "is_order_bump": false
        },
        {
            "id": "5ee0b6f0-dd6c-447f-9cdc-3285ec9db259",
            "name": "Excel para Investidores",
            "offer_id": "b0dd1f45-8fce-46ad-81ac-ad48477dff98",
            "offer_name": "Excel para Investidores",
            "description": "O melhor curso para quem quer começar a investir e ainda aprender a gerenciar sua carteira.",
            "price": "R$ 49,90",
            "photo": "https://s3.amazonaws.com/develop.kirvano.com/products/e266220e-f663-4416-9744-5058b790d9e2/cover-1702928377361.jpg",
            "is_order_bump": true
        }
    ],
    "utm": {
        "src": "google",
        "utm_source": "broadcast",
        "utm_medium": "email",
        "utm_campaign": "register",
        "utm_term": "codes",
        "utm_content": "link"
    }
}
```