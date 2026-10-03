# FLUXO · Rio Pequeno × Corifeu

Sistema acadêmico em português para comparar uma referência **estimada em 2026** com cenários até 2036. O raio de 2 km seleciona população e registros imobiliários; a atribuição inclui viagens regionais externas. Não representa tráfego em tempo real.

O painel utiliza dados públicos efetivamente processados da OD 2023 revisada, Censo 2022, alvarás residenciais PDE, HIS/HMP GeoSampa e OpenStreetMap. Só agregados, geometria pública e parâmetros são publicados em `public/data`. Microdados e caches permanecem locais em `data/raw` e `data/processed`, ignorados pelo Git.

## Executar o painel

Requisitos: Node >=22.13, npm e, para reprocessar bases, Python 3.14 (versão desta execução). Dependências fixadas em `package-lock.json` e `requirements.lock`.

```sh
cd /Users/m/dev/pilu/fluxo-rio-pequeno
npm ci
npm run dev
```

O terminal informa o endereço local. A base agregada está incluída; não é necessário baixar microdados para usar ou desenvolver o painel.

```sh
npm run typecheck
npm run test:model
npm run build
```

O build estático fica em `dist/client`. `.openai/hosting.json` vincula o projeto ao Sites. Não há contas nem armazenamento compartilhado: cenários ficam no navegador, com importação/exportação JSON e resultados CSV.

## Reproduzir os dados

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
npm run data:download
npm run data:build
npm run test:pipeline
```

O download é superior a 1 GB, principalmente pelo extrato OSM Sudeste. O processamento inicial é intensivo em memória/CPU; recomenda-se pelo menos 12 GB de memória disponível. Execuções posteriores reutilizam Parquet e grafos. Credenciais SPTrans não são necessárias. Endereços oficiais em `pipeline/study.py` e no manifesto.

O download preserva arquivos existentes. Para atualizar uma fonte, arquive a execução anterior, substitua seu arquivo em `data/raw` e processe novamente. Hashes detectam mudanças e invalidam caches e extrações. Ao alterar processamento, aumente `VERSION` ou execute:

```sh
.venv/bin/python pipeline/study.py build --clean-cache
```

O `runId` combina versões, referência, hashes de entradas, implementação e dependências. `generatedAt` registra a execução sem modificar a identidade. URLs correntes podem oferecer conteúdo diferente no futuro: guarde arquivos brutos e manifesto para reprodução exata.

## Simulação em lote

Exporte um cenário JSON no painel e use a mesma execução agregada:

```sh
npm run simulate -- cenario.json data/processed/resultado.json
```

Sem cenário, usa parâmetros padrão e projetos selecionados. O comando compila o mesmo núcleo TypeScript do Web Worker. Cenários de outra execução são rejeitados. `test:model` compara o protocolo do Worker compilado com o motor de lote.

## Calibração local posterior

Preencha uma cópia de `data/counts-template.csv`. Campos: `date` ISO, `start_time` HH:MM, `interval_minutes`, `movement` (`rio`, `east`, `west`), `mode` (`car`, `moto`, `bus`, `bike`), `count` inteiro e `split` (`train` ou `validation`). Use dias úteis distintos para ajuste e avaliação; intervalos não podem se sobrepor nem atravessar uma hora.

```sh
.venv/bin/python pipeline/counts.py minhas-contagens.csv \
  --bundle public/data/study.json \
  --output data/processed/calibrated-study.json
```

O relatório calcula MAE e WAPE em dias reservados. A calibração por classe/aproximação não valida automaticamente efeitos populacionais. Classes sem referência são preenchidas somente em horários medidos. WAPE é indisponível quando a soma observada é zero. Examine os relatórios antes de substituir a base pública e gerar novo build; contagens originais permanecem locais.

## Recursos e limites

- Agora/Depois, mapa real com raio e registros, tabelas alternativas, perfil horário e evolução anual.
- População líquida, projetos incluídos, datas hipotéticas, ocupação, moradores/unidade, modos e ocupação dos veículos.
- Cinco zonas comparáveis; sensibilidade com três/dez zonas, taxas de viagem e velocidades.
- Transferência para ônibus/bicicleta, ônibus adicionais e deslocamento de picos.
- Fontes, versões, hashes, critérios, pendências e faixas junto aos resultados.

Os 112 registros deduplicados e suas unidades **licenciadas** não comprovam obra, entrega, estoque futuro ou ocupação. Entregas ficam pendentes até evidência ou hipótese explícita. +5 mil é adicional líquido, com opção de substituir o crescimento imobiliário.

Não há contagens recentes confirmadas do cruzamento ou circulação de ônibus integrada. `null` significa desconhecido. O painel não apresenta total completo de automotores. Ônibus adicionais são incremento conhecido, sem tornar conhecido o total de ônibus. Oferta e demanda de passageiros são distintas, sem capacidade garantida.

A referência mantém padrões OD 2023 em 2026. Horários são de saída da viagem. Atribuição exploratória usa centroides OD, sentidos OSM e tempos livres; não modela restrições de conversão ou desvio por congestionamento. Carga, táxi/aplicativo e deslocamentos vazios não estão quantificados. Amostra local é pequena. Faixas são sensibilidade, não confiança. Filas, atrasos e otimização semafórica exigem levantamento local.

População, domicílios e viagens produzidas reproduzem as tabelas OD dentro da tolerância. A frota domiciliar apresenta divergência documentada e **não é usada no fluxo**. Consulte a [metodologia](docs/METODOLOGIA.md).

## Arquivos principais

| Arquivo                     | Responsabilidade                                       |
| --------------------------- | ------------------------------------------------------ |
| `pipeline/study.py`         | ETL espacial, OD, deduplicação, rede OSMnx e agregação |
| `pipeline/counts.py`        | Calibração e validação reservada                       |
| `lib/model/contracts.ts`    | Contratos versionados e validação                      |
| `lib/model/engine.ts`       | Motor puro compartilhado                               |
| `lib/model/worker.ts`       | Simulação em segundo plano                             |
| `components/dashboard.tsx`  | Painel e exportações                                   |
| `public/data/manifest.json` | Proveniência e conferências                            |
| `public/data/study.json`    | Dados agregados publicados                             |

Fontes mantêm suas licenças. Mapa/rede: © OpenStreetMap contributors, ODbL. Confira condições dos provedores antes de redistribuir microdados.
