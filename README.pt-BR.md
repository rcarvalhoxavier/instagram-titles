# instagram-titles

*[Read in English](README.md)*

Se você hospeda o seu próprio Omnivore, provavelmente já reparou que todo link do Instagram que
você salva aparece na biblioteca com o título `Instagram`, e mais nada. Isso acontece porque uma
requisição anônima a uma página do Instagram não devolve `og:title` nem `og:description` para o
Omnivore ler — só `og:site_name`, que é sempre a palavra "Instagram". Esta ferramenta encontra
esses itens, busca o autor e a legenda no endpoint de embed público do Instagram, e reescreve o
título e o autor para que o item diga o que ele realmente é.

## O que ela não faz

Não baixa mídia, não arquiva conteúdo e não usa credencial nenhuma do Instagram — ela lê o
endpoint de embed público, o mesmo que qualquer site usa para mostrar um post incorporado, e se
identifica como `instagram-titles` ao fazer isso. Por isso, ela nunca
vai resolver contas privadas nem posts com restrição de idade. Se um post que você salvou é
privado, espere que o título continue `Instagram`; isso é intencional, não é defeito. Em qual dos
três estados abaixo esse post cai não foi testado contra uma conta privada de verdade, então este
documento não afirma nenhum.

## Gerando uma chave de API

Tudo abaixo precisa de uma. No Omnivore, vá em **Settings → API Keys** e crie uma chave. Dê um
nome que você reconheça depois, como `instagram-titles`, para poder revogar só essa mais adiante
sem mexer em mais nada.

A chave lê e escreve na sua biblioteca inteira. Mantenha ela fora do histórico do shell e de
qualquer arquivo versionado: coloque no `.env` que o seu stack já usa, ou num arquivo com
`chmod 600`, e referencie em vez de colar direto nos comandos.

## Rodando uma vez, da sua própria máquina

É o jeito mais rápido de ver o que a ferramenta faria com a sua biblioteca, sem instalar nada no
stack do Omnivore. Comece com `DRY_RUN=true`, que lê e registra mas nunca escreve:

```bash
OMNIVORE_API_KEY=$(cat ~/.config/instagram-titles.key) \
docker run --rm --init \
  -e OMNIVORE_API_URL=https://seu-omnivore.exemplo/api/graphql \
  -e OMNIVORE_API_KEY \
  -e DRY_RUN=true \
  ghcr.io/rcarvalhoxavier/instagram-titles:latest
```

Nomear `OMNIVORE_API_KEY` sem valor repassa a variável do ambiente, então a chave nunca aparece na
linha de comando do contêiner, onde o `ps` a mostraria para qualquer usuário local. O `--init` é o
que faz o `Ctrl-C` parar rápido; a seção abaixo explica por quê.

Sai uma linha por item que seria alterado, com o título e o autor que ela resolveu:

```
2026-09-21T12:55:13.302Z INFO  starting; interval=900s max_per_cycle=20 dry_run=true
2026-09-21T12:55:13.600Z INFO  cycle start: 5 candidate(s)
2026-09-21T12:55:21.940Z INFO  [dry-run] would retitle 1f26dba1-... to "3kg de molho de tomate por R$10!! ..." (byline ruimorschel)
2026-09-21T12:55:22.100Z INFO  cycle done: 5 found, 0 gone, 0 unknown
```

Leia essas linhas. Quando estiver satisfeito, tire o `DRY_RUN` e rode de novo para deixar
escrever. Ela continua rodando num laço temporizado, então pare com `Ctrl-C` assim que o primeiro
ciclo terminar — ou acrescente `-e MAX_PER_CYCLE=3` para mexer em poucos itens na primeira vez e
conferir o resultado à mão.

Se preferir não usar Docker e tiver Node.js 24 ou mais novo, a ferramenta não tem dependência de
runtime nenhuma:

```bash
git clone https://github.com/rcarvalhoxavier/instagram-titles
cd instagram-titles
OMNIVORE_API_URL=https://seu-omnivore.exemplo/api/graphql \
OMNIVORE_API_KEY="$(cat ~/.config/instagram-titles.key)" \
DRY_RUN=true npm start
```

## Instalando no seu stack do Omnivore

É assim que ela foi pensada para rodar: ao lado do Omnivore, num temporizador, corrigindo em
silêncio os links novos conforme chegam. Acrescente o serviço abaixo ao `docker-compose.yml` que
já sobe o seu stack, e ponha `OMNIVORE_API_KEY=...` no mesmo `.env` que esse stack já lê — com uma ressalva,
logo abaixo, se os seus serviços usam `env_file`. O bloco
completo está em [`compose.example.yaml`](compose.example.yaml):

```yaml
services:
  instagram-titles:
    image: ghcr.io/rcarvalhoxavier/instagram-titles:latest
    container_name: instagram-titles
    environment:
      OMNIVORE_API_URL: http://api:8080/api/graphql
      OMNIVORE_API_KEY: ${OMNIVORE_API_KEY:?set this in your .env}
      DRY_RUN: "true"
    init: true
    restart: unless-stopped
```

O `:latest` acompanha todo release. Para fixar uma versão, use o número sem o `v` —
`ghcr.io/rcarvalhoxavier/instagram-titles:0.1.0` — que é a convenção do Docker e o que a página do
registry lista. A partir da v0.1.1 os releases publicam também a grafia com `v`.

Dois detalhes ali merecem explicação.

O `OMNIVORE_API_URL` aponta para `http://api:8080/api/graphql`, e não para o seu hostname
público. Dentro da rede do compose a ferramenta fala direto com o serviço `api`, então o tráfego
nunca sai da máquina e não depende do seu proxy reverso ou túnel estarem no ar.

O `init: true` está ali para ceifar processos zumbis, que é para o que serve um init. Ele já foi
necessário por um segundo motivo — o contêiner levava o timeout inteiro para morrer —, mas isso
agora está resolvido na própria ferramenta, em vez de contornado aqui. A causa era específica e as
duas explicações óbvias estavam erradas: o Node **instala** sim um handler de `SIGTERM`, e o timer
pendente **não** era o que mantinha o processo vivo. Sem nenhum listener JavaScript registrado, o
handler do Node restaura a disposição padrão e re-levanta o sinal contra si mesmo — e sinal com
disposição padrão é exatamente o que o kernel recusa entregar ao PID 1. O `main.ts` agora registra
um listener, então o re-levantar nunca acontece. Medido nesta imagem: **11 segundos para parar
antes, 1 segundo depois, com ou sem init**.

### Se o seu compose usa `env_file`

O bloco acima lê a chave por interpolação: o Compose substitui `${OMNIVORE_API_KEY}` a partir do
`.env` ao lado do seu arquivo de compose, e só este serviço fica com ela. O compose original do
Omnivore declara `environment:` serviço a serviço, então com ele nada mais muda e o parágrafo
acima basta.

Se o seu stack foi adaptado para os serviços carregarem o arquivo inteiro com `env_file: .env`, o
quadro é outro. O `env_file` injeta *todas* as variáveis do arquivo em *cada* serviço que o lista,
então pôr a chave lá entrega aos containers `api`, `web` e `queue-processor` uma credencial que
lê e escreve na sua biblioteca inteira — e o Compose recria cada um deles, porque o ambiente
mudou.

Nesse caso, dê um arquivo próprio à chave e aponte só este serviço para ele:

```yaml
    env_file:
      - .env.instagram-titles
    environment:
      OMNIVORE_API_URL: http://api:8080/api/graphql
```

Medido num stack adaptado assim: com a chave no `.env` compartilhado, o `docker inspect` do
container `api` listava `OMNIVORE_API_KEY`; depois de movê-la para o arquivo próprio, não listava
mais.

Suba, acompanhe um ciclo, e só então deixe escrever:

```bash
docker compose up -d instagram-titles
docker compose logs -f instagram-titles
```

Quando a saída do dry-run parecer certa, remova a linha `DRY_RUN` (ou mude para `"false"`) e rode
`docker compose up -d instagram-titles` de novo.

## Desenvolvendo

Sem etapa de build, sem bundler, sem framework de teste. O Node 24 executa o TypeScript direto,
apagando os tipos, e os testes usam o runner embutido no próprio Node.

```bash
git clone https://github.com/rcarvalhoxavier/instagram-titles
cd instagram-titles
npm ci             # typescript, @types/node e os dois pacotes transitivos deles
npm test           # node --test src/*.test.ts
npm run typecheck  # tsc --noEmit
```

A suíte de testes nunca toca a rede. O diretório `fixtures/` guarda páginas de embed reais
capturadas do Instagram — uma para cada formato de resposta que o resolver precisa tratar — mais
um arquivo escrito à mão que faz o papel de uma resposta bloqueada. Esse último está marcado como
sintético no próprio comentário, porque nunca se observou um bloqueio real para capturar.

Duas regras que a CI cobra, e que vale conhecer antes de mandar um patch:

- **`src/` e `scripts/` são ASCII puro.** Escreva caracteres não-ASCII em forma escapada
  (`"\u2026"`, `"\u{1F680}"`), inclusive dentro de comentários. Não é frescura: um U+00A0
  invisível num arquivo de fonte virou, em silêncio, um espaço comum ao ser copiado, quebrando o
  contrato de uma função exportada enquanto todos os testes continuavam verdes.
- **Só sintaxe TypeScript apagável.** Nada de `enum`, `namespace` ou parameter properties
  (`constructor(private x)`). O type stripping do Node as rejeita, e o `tsc` está configurado
  para recusá-las antes que cheguem a alguém.

O `scripts/probe-api.ts` é um diagnóstico, não parte da ferramenta. Ele responde duas perguntas
sobre uma instância real do Omnivore — como a busca dela se comporta, se o `setLabels` substitui
ou acrescenta, e se o `updatePage` preserva os campos que não recebe — e restaura tudo que
altera:

```bash
OMNIVORE_API_URL=... OMNIVORE_API_KEY=... node scripts/probe-api.ts
```

## Como o código está organizado

Nove módulos pequenos, cada um com um trabalho, montados como um pipeline. Se algo quebrou, isto
diz qual arquivo abrir.

| Módulo | Trabalho |
| --- | --- |
| `config.ts` | Lê e valida toda configuração. É dono de todo padrão; nenhum outro arquivo tem um. |
| `selector.ts` | Decide quais itens da biblioteca podem ser tocados. A fronteira de segurança. |
| `fetcher.ts` | O único módulo que fala com o Instagram. De URL para HTML, com tentativas. |
| `resolver.ts` | Puro. De HTML para `found` / `gone` / `unknown`. Sem rede, sem relógio. |
| `title.ts` | Puro. De autor mais legenda para a string do título. |
| `writer.ts` | O único módulo que escreve na sua biblioteca. |
| `omnivore.ts` | O cliente GraphQL, e o contrato `Library` de que os outros dependem. |
| `cycle.ts` | Uma passagem: seleciona, resolve tudo, e só então escreve — com o disjuntor no meio. |
| `main.ts` | Configuração, o laço e o temporizador. 40 linhas. |

Uma mudança quase sempre cai em exatamente um deles. **O Instagram mudou o HTML** é a falha que
esta ferramenta existe para sobreviver, e ela cai em `resolver.ts` — comece por ali, e leia o
`resolver.test.ts` junto, porque os fixtures mostram como são os dois formatos de página.

## Configuração

| Variável | Padrão | Significado |
| --- | --- | --- |
| `OMNIVORE_API_URL` | *(obrigatória)* | Endpoint GraphQL da sua instância do Omnivore. |
| `OMNIVORE_API_KEY` | *(obrigatória)* | Chave de API usada para autenticar nesse endpoint. |
| `SCAN_INTERVAL` | `15m` | Quanto esperar entre ciclos. Aceita `90s`, `15m`, `2h`, ou um número puro de segundos; precisa ficar entre 60s e 24h. |
| `MAX_PER_CYCLE` | `20` | Máximo de itens resolvidos por ciclo. |
| `FETCH_RETRIES` | `3` | Total de tentativas por item contra o endpoint de embed, e não repetições depois da primeira. `1` significa uma tentativa só. |
| `TITLE_MAX_CHARS` | `120` | Tamanho em que o título gerado é cortado, em fronteira de palavra. |
| `GENERIC_TITLE_PATTERN` | `^Instagram$` | Expressão regular que reconhece um título ainda não corrigido. Leia o aviso abaixo da tabela antes de mudar. |
| `GIVE_UP_LABEL` | `instagram-unavailable` | Rótulo aplicado quando o Instagram confirma que o post sumiu. |
| `UNKNOWN_RATIO_LIMIT` | `0.5` | Fatia de resultados `unknown` num ciclo acima da qual o disjuntor dispara. |
| `MIN_SAMPLE_FOR_BREAKER` | `5` | Mínimo de itens num ciclo para o disjuntor poder disparar. |
| `RETRY_LABELED` | `false` | Com `true`, itens já marcados com `GIVE_UP_LABEL` voltam a ser considerados. |
| `DRY_RUN` | `false` | Com `true`, registra o que escreveria e não escreve nada. |

Todo valor é conferido na partida. Um erro de digitação falha imediatamente, com mensagem
nomeando a variável, em vez de virar um `NaN` que faz a ferramenta não fazer nada em silêncio.

### Uma configuração para tratar com cuidado

O `GENERIC_TITLE_PATTERN` é o único portão que decide quais itens são reescritos. O padrão está
ancorado nas duas pontas, então casa a string exata `Instagram` e mais nada — nem `Instagram
post`, nem `instagram`, nem um título seu que apenas mencione o Instagram. Afrouxe e a ferramenta
vai sobrescrever títulos que você mesmo escreveu; ela não consegue distinguir os seus dos que ela
colocou. Se você já gastou tempo renomeando links do Instagram à mão, esse trabalho está
protegido por esse padrão e por mais nada.

## Como ela decide

Para cada item candidato, a resposta do endpoint de embed é classificada em exatamente um de três
estados:

| Estado | Significado | Efeito |
| --- | --- | --- |
| `found` | Havia marcador de autor; pode ou não haver legenda. | Título e autor são reescritos. |
| `gone` | Havia o marcador de "mídia quebrada" do próprio Instagram — ele afirmou que o post está indisponível. | O item recebe o `GIVE_UP_LABEL` para não ser retentado a cada ciclo. |
| `unknown` | Nenhum dos dois marcadores, resposta não interpretável, ou a requisição falhou de vez. | **Nada é escrito.** |

O `unknown` nunca escreve, de propósito. É o estado onde caem um bloqueio temporário, uma mudança
no HTML do Instagram, ou um bug desta ferramenta — e nenhum deles pode ser confundido com "o
Instagram confirmou que este post sumiu". Um item que volta `unknown` simplesmente mantém o
título atual e é reconsiderado num ciclo posterior.

Além disso, um disjuntor olha o ciclo inteiro, e não um item de cada vez: uma vez classificados
pelo menos `MIN_SAMPLE_FOR_BREAKER` itens, se mais que `UNKNOWN_RATIO_LIMIT` deles voltaram
`unknown`, o disjuntor dispara e **todas** as decisões daquele ciclo são descartadas — inclusive
as que voltaram `found` ou `gone` —, sem escrever nada na sua biblioteca. A ideia é que um pico
súbito de `unknown` já é evidência de que algo está errado (um bloqueio, uma mudança de formato),
e a resposta certa para "não consigo saber o que está acontecendo" é não escrever nada até o
próximo ciclo, em vez de adivinhar. É essa propriedade que permite confiar a ferramenta a uma
biblioteca que você não queria que fosse mexida: ou ela tem uma resposta clara, ou ela fica
quieta.

## Notas

Três dúvidas do desenho foram resolvidas contra uma instância real do Omnivore, em vez de
adivinhadas (o `scripts/probe-api.ts` refaz as verificações):

- A busca do Omnivore (`in:all instagram.com`) é uma correspondência de texto contra as páginas
  salvas, e não um filtro estrito por host — ela estreita bem os candidatos, mas ainda pode
  devolver itens que não são do Instagram. Por isso a ferramenta refiltra cada resultado do lado
  cliente (o `needsFix` do `selector.ts`) antes de tratar qualquer coisa como candidata.
- O `setLabels` **substitui** o conjunto inteiro de rótulos do item, em vez de acrescentar. É por
  isso que a ferramenta sempre lê os rótulos existentes antes de escrever: escrever rótulos de
  forma ingênua apagaria em silêncio qualquer rótulo que você já tivesse aplicado à mão.
- O `updatePage` faz o contrário: ele **preserva** os campos que você não envia. A ferramenta manda
  só título e autor, e a descrição, a data de salvamento e o nome do site do item continuam
  intactos. Isso foi medido, não suposto, porque o `setLabels` já tinha mostrado que a resposta
  intuitiva pode ser a errada.

### Como o Instagram decide o que nos mandar

O endpoint de embed responde com um app shell de JavaScript, e não com o embed, sempre que
consegue interpretar o `User-Agent` como uma família de navegador conhecida **com versão** —
`Chrome/<v> Safari/<v>` e `Firefox/<v>` recebem o shell. Todo o resto recebe o embed renderizado
no servidor, inclusive um `Mozilla/5.0` puro, um identificador arbitrário, e nenhum cabeçalho
`User-Agent`. Remover só a versão de uma string de Chrome no restante idêntica inverte a resposta
de volta para o embed — que é a assinatura de um parser de user-agent de verdade, e não de uma
lista de substrings.

Isso se lê como decisão de renderização, não como decisão anti-bot: não adianta mandar um shell de
JavaScript para um cliente que não vai executá-lo. É também por isso que o identificador desta
ferramenta é seguro por razão estrutural, e não por sorte — ele não carrega token de família de
navegador com versão. Se você for editá-lo, é a única coisa a evitar.

Medido em 17 variantes contra um post, de um IP, com um cliente TLS. O contraste dentro da bateria
foi limpo e um controle foi refeito ao final para descartar deriva, mas nada disso prova que o
comportamento se mantém de outra rede.

De todo modo o modo de falha é seguro por construção: um app shell não tem marcador de autor nem
marcador de mídia quebrada, então cai em `unknown`, o disjuntor dispara, e nada é escrito.
Fragilidade aqui custa disponibilidade, nunca correção.
## Sendo um bom vizinho

O intervalo padrão de 15 minutos, o teto de 20 itens por ciclo e a pausa de 1,5 segundo entre
requisições ao endpoint de embed existem todos pelo mesmo motivo: para que esta ferramenta,
multiplicada por quantas pessoas a rodarem, não some em cima da infraestrutura do Instagram. Por
favor, não baixe esses valores sem um motivo real — a ferramenta não tem pressa; a sua biblioteca
vai sendo corrigida aos poucos, ciclo após ciclo, sem ninguém precisar notar.

Ela também lê do seu próprio Omnivore: até 20 páginas de 100 itens por ciclo enquanto ainda houver
trabalho a encontrar, e nada quando a biblioteca está em dia. As requisições ao Instagram têm
timeout de 20 segundos e recuam dois segundos por tentativa; se o disjuntor disparar, o ciclo
seguinte espera uma hora inteira a mais, em vez de insistir com quem já está recusando.


## Licença

MIT. Veja [LICENSE](LICENSE).
