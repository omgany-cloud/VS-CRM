# Передача работы Claude Code

Начните с [docs/HANDOFF_CLAUDE_CODE.md](docs/HANDOFF_CLAUDE_CODE.md).
Там зафиксированы состояние на 28 октября 2026 года, решения пользователя,
расположение кода, проверки, запуск и ограничения работы с локальной базой.

Текущее ТЗ: [docs/TZ_CRM_Contracts_and_Client_Work.md](docs/TZ_CRM_Contracts_and_Client_Work.md), версия 1.18.
История изменений: [CHANGELOG.md](CHANGELOG.md).

Не запускайте seed, сброс базы или тесты на `server/data/crm.sqlite`:
там уже есть пользовательские данные. Тесты используют изолированные базы.
