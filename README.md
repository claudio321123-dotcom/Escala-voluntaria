# Escala da Transmissão

Ferramenta online para montar a equipe de transmissão dos cultos. Usa Firebase (Firestore + Authentication) e não precisa de build: são só arquivos estáticos.

## Como funciona

- **Voluntários** abrem o link, veem os cultos, escolhem uma função (Câmeras, Mesa de corte, Áudio, Streaming, Projeção, Legendas) e se inscrevem com nome e telefone. A inscrição fica **pendente** até o líder confirmar. Cada voluntário pode cancelar a própria inscrição.
- **Líder** entra com a conta Google (botão "Sou líder") e pode: criar/editar/excluir cultos, gerar a rotina das próximas semanas (domingo manhã/noite, quarta), definir quantas vagas há em cada função, confirmar ou remover inscrições, adicionar pessoas direto na escala, ver telefones e copiar a escala pronta para o WhatsApp.
- Tudo atualiza em tempo real para quem estiver com a página aberta.
- Telefones ficam em outra coleção e só o líder consegue ler.

## Configurar o Firebase (uma vez)

1. Em https://console.firebase.google.com crie um projeto.
2. **Firestore Database** > Criar banco de dados (modo produção).
3. **Authentication** > Método de login: ative **Google** e **Anônimo** (o anônimo permite que o voluntário cancele a própria inscrição sem criar conta).
4. **Configurações do projeto** > Seus apps > adicione um app **Web** e copie a configuração para `firebase-config.js`. Coloque também o seu e-mail em `LEADER_EMAILS`.
5. Em `firestore.rules`, troque `seu-email@gmail.com` pelo e-mail do líder (pode listar vários) e cole o conteúdo em **Firestore > Regras > Publicar**. As regras é que protegem os dados; a lista no JS só esconde os botões.
6. **Authentication > Configurações > Domínios autorizados**: adicione o domínio onde o site ficará (se usar Firebase Hosting, já vem autorizado).

## Publicar

Opção A, Firebase Hosting:

```
npm i -g firebase-tools
firebase login
firebase init   # escolha o projeto, mantenha firebase.json
firebase deploy
```

Opção B, GitHub Pages: ative Pages na branch com os arquivos na raiz e adicione `seu-usuario.github.io` aos domínios autorizados.

Para testar localmente: `python3 -m http.server 8000` e abra http://localhost:8000 (`localhost` já é autorizado).

## Observações

- Qualquer pessoa pode enviar inscrições pendentes (sem login). Se houver abuso, ative o App Check no Firebase.
- Os cultos passados deixam de aparecer na lista, mas continuam no banco.
