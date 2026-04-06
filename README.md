# Heeph Skin Server

Servidor de skins Yggdrasil para o Heeph Client.  
Hospede **uma vez** e todos os jogadores com o Heeph Client se veem automaticamente — sem conta em serviço externo.

## Como funciona

```
Jogador abre launcher → seleciona skin → launcher faz upload aqui
Jogador A entra no servidor → jogo pede skin do Jogador B aqui → A vê B
```

## Deploy gratuito no Railway

1. Crie conta em https://railway.app
2. Clique em **New Project → Deploy from GitHub repo**
3. Aponte para a pasta `skin-server/` (ou mova para um repo separado)
4. Adicione as variáveis de ambiente:
   - `UPLOAD_SECRET` → uma senha secreta (ex: `minha-senha-123`)
   - `DATA_DIR` → `/data` *(veja abaixo sobre volume persistente)*
5. **Volume persistente** (obrigatório para não perder skins):
   - Railway → seu serviço → **Volumes** → Add Volume → mount em `/data`
6. Copie a URL do deploy (ex: `https://heeph-skins.up.railway.app`)

## Deploy gratuito no Render

1. Crie conta em https://render.com
2. **New → Web Service → Connect repo**
3. Build command: `npm install`
4. Start command: `node server.js`
5. Variáveis de ambiente: `UPLOAD_SECRET`, `PORT=3000`
6. Adicione um **Disk** em `/data` (Render → seu serviço → Disks)

## Configurar no launcher

Após o deploy, edite `%APPDATA%\.heephclient\config.json`:

```json
"heephSkinServer": {
  "url": "https://SEU-SERVIDOR.up.railway.app",
  "uploadSecret": "minha-senha-123"
},
"authlibInjector": {
  "enabled": true,
  ...
}
```

> O `uploadSecret` do launcher deve ser **igual** ao `UPLOAD_SECRET` do servidor.

## Resultado

- Jogador abre aba **SKINS** no launcher
- Ativa o toggle **"Skins no jogo"**
- Clica na skin desejada → é enviada automaticamente ao servidor
- Todos com Heeph Client veem a skin no jogo

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `UPLOAD_SECRET` | `heeph-secret-123` | Senha para upload de skins |
| `DATA_DIR` | `./data` | Pasta de dados (skins + chaves) |
