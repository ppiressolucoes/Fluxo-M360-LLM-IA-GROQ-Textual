# M360 Core Editorial — LLM IA GROQ Textual

Exports versionados dos workflows n8n para classificação editorial de categorias, tags e autores com modelos servidos pela GROQ.

## Workflows

- [Classificador Categoria Textual — Pilot v1](workflows/llm-groq-classificador-categoria-textual-pilot-v1.json)
- [INTER AI Cross Account Textual](workflows/llm-groq-inter-ai-cross-account-textual.json)
- [SUB — Classifica PEL: Categoria, Autor e Tags — GROQ v0.2](workflows/sub-classifica-pel-categoria-autor-tags-groq-v0.2.json)

O subworkflow PEL chama o workflow Pilot v1 pelo ID n8n registrado no export. Preserve os IDs ao importar ou atualize a referência do node de chamada para o ID criado no seu ambiente.

## Validação da classificação

O node **OUTPUT: Validar Categoria** valida a resposta do modelo contra os catálogos dinâmicos do workflow pai (categorias e tags), além de verificar autor, quantidade de tags e estrutura. A cópia do código está em [docs/validar-categoria-node.js](docs/validar-categoria-node.js).

As consultas dos catálogos de categorias e tags do subworkflow PEL ordenam os resultados por id (ORDER BY id) para produzir listas estáveis no prompt.

## Importação e configuração

1. Importe os JSONs no n8n.
2. Configure as credenciais MySQL correspondentes aos nodes que consultam o catálogo de APIs GROQ e os dados PEL. As referências de credencial da instância de origem foram removidas destes exports.
3. Confira as credenciais e a API selecionada no ambiente de destino.
4. Garanta que a referência do subworkflow ao workflow Pilot v1 corresponda ao ID de workflow disponível na instância.
5. Revise os catálogos e execute um teste controlado antes de ativar os workflows.

Os exports não incluem valores de chaves de API. O node HTTP obtém a chave dinamicamente do registro de API configurado no n8n.

## Observações

- Os exports mantêm os IDs dos workflows e nodes para facilitar a referência entre eles; ao importar em uma instância com IDs diferentes, ajuste a chamada entre workflows.
- Credenciais são específicas de cada instância n8n e precisam ser vinculadas localmente.
## Retry de respostas incompletas

O workflow Pilot v1 trata finish_reason length e respostas JSON incompletas como falhas de resposta, encaminhando-as para retry. A primeira chamada usa 1024 tokens de conclusão; as novas tentativas ampliam o limite progressivamente até 3072 e mantêm response_format json_object.
## Tratamento de erros HTTP

O node HTTP Groq usa saída regular (Continue On Fail). O node Normalizar Retorno HTTP Groq identifica sucesso ou erro e o node IF | HTTP Groq com erro? encaminha erros para Normalizar Erro Groq e respostas válidas para Validar Classificação Saída v0.2. O output de erro dedicado do node HTTP não é usado.
