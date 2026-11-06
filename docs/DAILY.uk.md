# Snake Eye щодня — коротка інструкція

Українська версія для Windows і PowerShell. Повна англійська, з таблицею
помилок, — у [DAILY.md](DAILY.md).

> **Одна папка проєкту.** Сайт показує дані з `data\stocks.local.json` тієї
> папки, з якої запущено `npm start`. Якщо на комп'ютері дві копії Snake Eye,
> оновлення й дані легко потрапляють не туди. Нижче папка проєкту —
> `$HOME\Documents\Snake-Eye`; якщо ваша інша, підставте свою.
>
> Перевірити, скільки копій є:
>
> ```powershell
> Get-ChildItem $HOME -Recurse -Filter stocks.local*.json -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime
> ```

---

## А. Просто подивитися сайт — 1 вікно

Шлюз IBKR не потрібен.

**Вікно 1 — PowerShell**

```powershell
cd $HOME\Documents\Snake-Eye
npm start
```

Відкрийте в браузері **http://localhost:8080**. Саме цю адресу, а не файл
`index.html` подвійним кліком — так скрипти не запрацюють.

Вікно не закривайте: воно і є сервером. Зупинити — `Ctrl + C`.

---

## Б. Оновити ціни й подивитися — 3 вікна

Після закриття біржі (після 23:00 за Києвом).

### Вікно 1 — шлюз IBKR

```powershell
cd $HOME\ibkr\clientportal.gw
bin\run.bat root\conf.yaml
```

1. Дочекайтеся рядка `Open https://localhost:5000 to login`.
2. Відкрийте **https://localhost:5000**. Попередження про сертифікат —
   нормально для локального шлюзу: *Додатково → Перейти на localhost*.
3. Увійдіть і підтвердіть вхід на телефоні. Сторінка напише
   *Client login succeeds*.
4. **Не закривайте це вікно** — разом із ним зупиняється і завантаження.

### Вікно 2 — завантаження даних

```powershell
cd $HOME\Documents\Snake-Eye
chcp 65001
npm run gateway
```

`npm run gateway` має написати `ready`. Якщо пише `403 — not logged in`,
повторіть вхід на https://localhost:5000.

```powershell
npm run ingest
```

На кількасот тікерів це кілька годин — IBKR обмежує частоту запитів.
Дочекайтеся рядка `✓ … symbols written to data/stocks.local.json`.

**Зупинилося посередині — запустіть ту саму команду ще раз.** Сон комп'ютера,
закрите вікно, вихід із IBKR: уже завантажене збережено в
`data\stocks.local.partial.json`, і `npm run ingest` продовжить з того місця.
Поки нове завантаження не завершене, сайт показує попередні повні дані.

`chcp 65001` лише вмикає UTF-8 у консолі, щоб замість `вЂ"` були стрілки й
тире. Достатньо раз на кожне нове вікно.

### Вікно 3 — сайт

```powershell
cd $HOME\Documents\Snake-Eye
npm start
```

Відкрийте **http://localhost:8080** і натисніть `Ctrl + F5`.

---

## Не щодня

| Коли | Що виконати в папці проєкту |
|---|---|
| Після злиття нового PR на GitHub | `git pull origin main`, потім перезапустити `npm start` |
| Раз на квартал (нові звіти) або після додавання тікерів | `npm run fundamentals -- --contact ваша@пошта.com` |
| Змінити список тікерів (потрібен шлюз) | `npm run universe -- --nyse --max-price 20` |
| Подивитися список | `npm run universe` |
| Один тікер на вимогу | `npm run ticker -- PLUG` або поле на сторінці *My tickers* |

`npm run fundamentals` заповнює з SEC фундаментальні дані, галузь і тип
(акція, ADR, фонд). Наступні `npm run ingest` і додавання тікерів їх
зберігають, тож повторювати щодня не потрібно. Для фондів і компаній, що
звітують не в доларах, фундаментальних даних не буде — скрипт пише чому.

`git status` показує `modified: config/universe.json` — це ваш список тікерів,
так і має бути. `git pull` його не чіпає.
