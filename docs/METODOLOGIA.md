# Metodologia · versão 1.0

## Área, referência e proveniência

O centro é a média dos nós comuns às avenidas no OSM. Buffer de 2.000 m em SIRGAS 2000 / UTM 23S (EPSG:31983). População e imóveis usam esse limite; viagens incluem a rede regional. Referência fixa: 03/10/2026. Padrões: OD 2023 revisada 19/02/2025; população: Censo 2022. Não há atualização demográfica implícita. Cenários são avaliados em 31 de dezembro; 2026 reproduz a referência sem incremento.

Contratos `Manifest`, `StudyBundle`, `Scenario`, `ScenarioResult` em `lib/model/contracts.ts`, esquema 1.0. A versão do bundle também está no manifesto. Cenários têm validação Zod de limites, datas reais, soma modal e identidade. Versões distintas de modelo/execução são rejeitadas. O manifesto registra URLs, coleta, versão, licença, transformações e hashes SHA-256 de entradas/código/dependências. Guarde snapshots brutos para reprodução histórica.

## Censo e imóveis

População V0001 e domicílios ocupados V0007 são multiplicados pela proporção da área do setor dentro do raio. A interpolação pressupõe ocupação uniforme. Ausência/supressão é reportada, sem imputação.

PDE e HIS/HMP são filtrados espacialmente. Processos são normalizados por dígitos e SQL por setor/quadra/lote (dez dígitos), removendo o dígito verificador PDE e preservando listas de lotes. O mesmo processo entre fontes é único; PDE fornece o total residencial e HIS/HMP sua parcela. Revisões não somam unidades. Múltiplos processos no SQL são conservadoramente agrupados, preservando evidências e revisão mais recente; fases distintas podem ser agrupadas. Endereço, processo, SQL, coordenadas, unidades, data do alvará e evidências são conservados. Alvará jamais vira entrega. Sem entrega/unidades o imóvel fica pendente; entrega anterior à referência exige ocupação de referência. Edições são hipóteses, não atualização da fonte.

## Zonas semelhantes

Alvo: média dos atributos das zonas intersectadas pelo buffer, ponderada pela população. Candidatas: São Paulo (código municipal 36 no shapefile); excluem-se zonas do estudo. Cinco atributos com peso igual: renda familiar ponderada FE_FAM, população/hectare, moradores/domicílio, empregos/morador e acessibilidade.

Acessibilidade é `1/(1+distância_km)` do centroide à parada/estação OSM mais próxima, sem frequência/qualidade/oferta. Atributos são padronizados pelo desvio-padrão das candidatas. Distância é raiz da média dos quadrados das diferenças ao alvo. Escolhem-se k menores distâncias. Pesos de zonas são inversos a `max(distância,0,05)`, normalizados. k=5 padrão; k=3/10 comparações. Zonas, atributos e pesos são públicos.

## Viagens e veículos

F_DOM/F_FAM/F_PESS com FE_DOM/FE_FAM/FE_PESS conferem domicílios/famílias/pessoas. N_VIAG>0 usa FE_VIA. Nas zonas semelhantes, taxas de viagens por morador são ponderadas pelos pesos de similaridade. MOTIVO conserva finalidades; distribuições modais e horárias são marginais da mesma amostra. Finalidade é detalhamento da demanda, sem modelo causal separado ou alteração individual por finalidade.

Demanda diária = população líquida × taxa. Participações modais somam 1. Passageiros de carro (10) e moto (14) são pessoas; só motoristas (9/13) geram referência veicular. Ocupação = viagens de pessoas da classe / viagens de motoristas ponderadas. Incremento = demanda da classe / ocupação × probabilidade de passagem × perfil horário.

Frota é distinta de uso. Sua reconstrução com respostas declaradas diverge parcialmente da Tab1; divergência conservada, frota não usada no fluxo. População, domicílios e viagens produzidas devem diferir menos de cinco unidades dos totais zonais oficiais ou o pipeline falha.

## Rede e atribuição

Extrato OSM regional vira grafo direcionado com classes, sentidos e acessos. OSMnx simplifica nós intermediários preservando mudanças de nome/velocidade e interseção. Para custo computacional, ruas locais são detalhadas até 12 km; fora permanecem arteriais. Centroides OD conectam ao nó mais próximo. Bicicleta usa grafo próprio, sem vias incompatíveis.

Menor tempo usa velocidade OSM ou hipótese por classe; não considera congestionamento, semáforos ou restrições de conversão. Caminhos entram no agrupamento de 45 m e são classificados Rio Pequeno, Corifeu sentido Butantã ou sentido Osasco. São aproximações, não conversões de faixa. Falta geometria operacional para esse detalhamento.

A referência soma FE_VIA de motoristas/bicicletas que atravessam, incluindo pares externos. Probabilidades do incremento vêm das viagens dos moradores geolocalizados no raio. Imóveis compartilham coeficientes regionais; não há rotas individuais de acesso. Velocidades arteriais variam ±20%. Sem passagem na pequena amostra pode haver zero estimado, sem comprovar ausência real.

## Crescimento e intervenções

Ocupação linear após entrega: 24 meses por padrão, editável 1–120 meses, até ocupação final escolhida. Subtrai-se ocupação de referência, sem incremento negativo. Moradores = unidades × moradores/unidade × incremento de ocupação. +5 mil é líquido adicional; `replace` substitui incremento imobiliário. Crescimento manual é linear de 2026 ao ano escolhido e constante depois. Demanda externa permanece constante.

Transferência modal remove viagens incrementais de carro para ônibus/bicicleta conservando pessoas. Oferta é separada: ônibus adicionais/h operam 6–23h, 17 horas, distribuídos igualmente nas aproximações como hipótese. Não se presume redução de carros nem capacidade de passageiros. Demanda de pessoas de ônibus em `peopleTrips.bus`.

Deslocamento de picos retira fração dos perfis incrementais carro/moto de 7–9h e 17–19h para 10h/20h, conservando o dia. Viagens de fundo não são alteradas. Semáforos, travessias, acessos e obras são sugestões qualitativas.

## Ausência, sensibilidade e validação

Ausência é `null`; uma parcela ausente conserva o total ausente. Ônibus inicialmente sem referência impedem total de automotores. Carga, táxi/aplicativo e viagens vazias também estão excluídos. Total carros+motos é parcial. É possível conhecer incremento de serviço sem total de ônibus. CSV conserva vazios para ausência.

Faixas: mínimo/máximo de alterações isoladas k=3/5/10 (incluindo modos/ocupações das zonas), arteriais ±20%, taxa ±20% e ocupações ±20% com limites 1–8 pessoas/carro e 1–2 pessoas/moto. Não são combinações fatoriais nem confiança. Outras ocupações/participações podem ser comparadas como cenários exportados. Não há precisão inferida antes de validação externa.

Testes cobrem conservação, divisão pessoas/veículo, dupla contagem, referência, evolução anual, datas pendentes/inválidas, ausência, transferências, ônibus, importação, CSV e equivalência Worker/lote. Calibração local usa ajuste por classe/aproximação com dias distintos de validação. Intervalos duplicados/sobrepostos são rejeitados. MAE/WAPE têm cobertura explícita; extrapolações populacionais precisam de avaliação separada.
