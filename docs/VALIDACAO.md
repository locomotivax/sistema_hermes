# Verificação da entrega · 03/10/2026

Execução agregada: `0d3dd3ae80929afc`, modelo 1.0.0. Não se trata de validação externa da precisão de tráfego; contagens independentes locais permanecem pendentes.

- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado.
- `npm run test:model`: aprovado, incluindo conservação, passageiros/veículos, cronologia, ausência, JSON/CSV, intervenções e equivalência entre Worker compilado e motor de lote com a base publicada.
- `npm run test:pipeline`: cinco testes aprovados, incluindo dígito verificador SQL, múltiplos lotes, HIS como subconjunto, contagens sem sobreposição e dias independentes de validação.
- Build estático: aprovado, com artefatos agregados e Worker. O aviso de chunk JavaScript acima de 500 kB não impede o build.
- Conferências OD: diferença máxima zonal de população 0,000039; domicílios 0,000064; viagens produzidas aproximadamente 0,000000005. Frota diverge até 781,625 unidades e está explicitamente excluída do cálculo do fluxo.
- Cadastro: 112 registros deduplicados, 18.775 unidades licenciadas identificadas, todas as entregas pendentes. Quantidade não comprova estoque futuro ou ocupação.
- Interface: conferência visual desktop e emulação móvel de 400 pixels. Corrigida largura mínima que excedia o espaço móvel. Abas acessíveis por foco, setas e Enter; alternativa tabular consultada no navegador.
- Exportações pelo navegador: CSV `fluxo-2030.csv` e JSON `cenario.json` concluídos; o JSON exportado foi importado e a interface confirmou recálculo.
- Os testes do modelo usam fixtures numéricas isoladas; o painel publicado utiliza exclusivamente a base pública processada.

Limites mantidos na interface e no manifesto: referência histórica, circulação de ônibus ausente, cronogramas hipotéticos, viagens externas constantes, rotas por centroides sem congestionamento/restrições de conversão e sensibilidade sem interpretação de confiança estatística.
