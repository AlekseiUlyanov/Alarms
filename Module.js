/**
 * PILOT Extension: Мониторинг неполадок (датчики EXT)
 *
 * Функциональность:
 * - Периодически опрашивает API https://online.gkstolica.ru/api/api.php?cmd=list&node=5 для получения списка ТС и статусов датчиков.
 * - Аутентификация: Basic Auth (логин/пароль берутся из глобальных переменных window.ALARMS_LOGIN и window.ALARMS_PASSWORD).
 * - Анализирует датчики с именами, начинающимися на "EXT" (конкретно: "EXT ТС в движении", "EXT Низкий уровень топлива").
 * - Считает неполадку активной, если hum_value датчика равен "вкл." (может быть изменено позже).
 * - Отображает в левой панели навигации список типов неполадок с количеством активных ТС.
 * - При клике на тип неполадки справа (в mapframe) показывает список ТС, у которых эта неполадка активна.
 *
 * Паттерн интеграции: Pattern 1 (Navigation tab + Mapframe panel)
 */

Ext.define('Store.Alarms.Module', {
    extend: 'Ext.Component',

    /**
     * Хранилище агрегированных данных по неполадкам.
     * Ключ: полное имя датчика (например, "EXT ТС в движении")
     * Значение: объект { count, vehicles } где vehicles – массив объектов с agentid, name, value, timestamp
     */
    alarmData: null,

    /**
     * Ссылка на store левой панели (типы неполадок)
     */
    leftStore: null,

    /**
     * Ссылка на store правой панели (ТС для выбранной неполадки)
     */
    rightStore: null,

    /**
     * Таймер для периодического обновления
     */
    refreshTask: null,

    /**
     * Текущий выбранный тип неполадки (полное имя датчика)
     */
    selectedAlarm: null,

    /**
     * Флаг, что модуль уже инициализирован (предотвращает повторное добавление)
     */
    initialized: false,

    /**
     * Флаг, что конфиг загружен (логин/пароль доступны)
     */
    configLoaded: false,

    initModule: function () {
        var me = this;

        if (me.initialized) return;
        me.initialized = true;

        // Проверяем, есть ли логин и пароль
        if (window.ALARMS_LOGIN && window.ALARMS_PASSWORD) {
            me.configLoaded = true;
            me.realInit();
        } else {
            // Если нет, загружаем config.js
            me.loadConfig();
        }
    },

    /**
     * Определяет базовый URL, откуда загружен текущий скрипт (Module.js).
     * @return {String} Базовый URL (например, "https://raw.githubusercontent.com/user/repo/branch/")
     */
    getBaseUrl: function() {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src;
            if (src && src.indexOf('Module.js') !== -1) {
                return src.substring(0, src.lastIndexOf('/') + 1);
            }
        }
        // Если не нашли (например, скрипт загружен не через src), возвращаем пустую строку
        return '';
    },

    /**
     * Загрузка конфигурационного файла config.js
     */
    loadConfig: function () {
        var me = this;
        var baseUrl = me.getBaseUrl();

        if (!baseUrl) {
            Ext.log('Alarms: не удалось определить базовый URL для загрузки config.js');
            return;
        }

        var script = document.createElement('script');
        script.src = baseUrl + 'config.js';
        script.onload = function () {
            me.configLoaded = true;
            me.realInit();
        };
        script.onerror = function () {
            Ext.log('Alarms: не удалось загрузить config.js');
            // Можно показать сообщение пользователю, но для простоты просто логируем
        };
        document.head.appendChild(script);
    },

    /**
     * Настоящая инициализация, которая выполняется после того, как логин/пароль гарантированно доступны.
     */
    realInit: function () {
        var me = this;

        if (!me.configLoaded || !window.ALARMS_LOGIN || !window.ALARMS_PASSWORD) {
            Ext.log('Alarms: логин или пароль не заданы');
            return;
        }

        // Сохраняем ссылку на модуль для доступа из обработчиков (если потребуется)
        window.AlarmsModule = me;

        // Создаём stores
        me.leftStore = Ext.create('Ext.data.Store', {
            fields: ['alarmName', 'displayName', 'count'],
            data: [
                { alarmName: 'EXT ТС в движении', displayName: 'ТС в движении', count: 0 },
                { alarmName: 'EXT Низкий уровень топлива', displayName: 'Низкий уровень топлива', count: 0 }
            ]
        });

        me.rightStore = Ext.create('Ext.data.Store', {
            fields: ['agentid', 'vehiclenumber', 'value', 'timestamp']
        });

        // Создаём компоненты левой и правой панели
        var navTab = Ext.create('Ext.grid.Panel', {
            title: 'Мониторинг неполадок',
            iconCls: 'fa fa-exclamation-triangle', // Font Awesome v6
            iconAlign: 'top',
            store: me.leftStore,
            columns: [
                { text: 'Неполадка', dataIndex: 'displayName', flex: 2 },
                { text: 'Количество', dataIndex: 'count', flex: 1, align: 'center' }
            ],
            hideHeaders: false,
            listeners: {
                select: function (grid, record) {
                    var alarmName = record.get('alarmName');
                    me.selectedAlarm = alarmName;
                    me.updateRightPanel(alarmName);
                }
            }
        });

        var mainPanel = Ext.create('Ext.grid.Panel', {
            title: 'Список транспортных средств',
            store: me.rightStore,
            columns: [
                { text: 'Госномер', dataIndex: 'vehiclenumber', flex: 2 },
                { text: 'Значение датчика', dataIndex: 'value', flex: 1 },
                { text: 'Время обновления', dataIndex: 'timestamp', flex: 2, xtype: 'datecolumn', format: 'd.m.Y H:i:s' }
            ]
        });

        // Обязательная связка для Pattern 1
        navTab.map_frame = mainPanel;

        // Добавляем в скелет PILOT
        if (skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(navTab);
            skeleton.mapframe.add(mainPanel);
        } else {
            Ext.log('Alarms: skeleton не доступен');
            return;
        }

        // Запускаем периодический опрос API
        me.refreshTask = setInterval(function () {
            me.fetchUnits();
        }, 30000); // каждые 30 секунд

        // Немедленно выполняем первый запрос
        me.fetchUnits();
    },

    /**
     * Запрос к API для получения списка ТС и статусов датчиков.
     */
    fetchUnits: function () {
        var me = this;

        // Формируем заголовок Basic Auth
        var auth = 'Basic ' + btoa(window.ALARMS_LOGIN + ':' + window.ALARMS_PASSWORD);

        Ext.Ajax.request({
            url: 'https://online.gkstolica.ru/api/api.php?cmd=list&node=5',
            method: 'GET',
            headers: {
                'Authorization': auth
            },
            disableCaching: false, // чтобы не добавлял _dc
            success: function (response) {
                var data;
                try {
                    data = Ext.decode(response.responseText);
                } catch (e) {
                    Ext.log('Alarms: ошибка парсинга ответа');
                    return;
                }

                if (data.code !== 0 || !data.list) {
                    Ext.log('Alarms: API вернул ошибку или пустой список');
                    return;
                }

                me.processUnits(data.list);
            },
            failure: function (response) {
                if (response.status === 401) {
                    Ext.log('Alarms: ошибка авторизации (401) – проверьте логин/пароль');
                } else {
                    Ext.log('Alarms: ошибка запроса к API, статус: ' + response.status);
                }
            }
        });
    },

    /**
     * Обработка полученного списка ТС.
     * Обновляет alarmData, leftStore и, при необходимости, rightStore.
     * @param {Array} units - массив объектов ТС из API
     */
    processUnits: function (units) {
        var me = this;

        // Инициализируем структуру данных
        var newAlarmData = {
            'EXT ТС в движении': { count: 0, vehicles: [] },
            'EXT Низкий уровень топлива': { count: 0, vehicles: [] }
        };

        Ext.Array.forEach(units, function (unit) {
            var agentid = unit.agentid;
            var vehiclenumber = unit.vehiclenumber || 'Без номера';
            var sensorsStatus = unit.sensors_status || [];

            // Проходим по каждому датчику
            Ext.Array.forEach(sensorsStatus, function (sensor) {
                var sensorName = sensor.name || '';
                // Проверяем, начинается ли имя с "EXT"
                if (sensorName.indexOf('EXT') === 0) {
                    // Проверяем, относится ли он к интересующим нас типам
                    if (newAlarmData.hasOwnProperty(sensorName)) {
                        var value = sensor.hum_value || '';
                        // ВНИМАНИЕ: условие активности неполадки. Сейчас проверяем на точное совпадение "вкл."
                        // Это может быть изменено позже под реальные данные датчиков.
                        if (value === 'вкл.') {
                            var timestamp = sensor.change_ts ? parseInt(sensor.change_ts, 10) * 1000 : null; // конвертируем в мс
                            newAlarmData[sensorName].count++;
                            newAlarmData[sensorName].vehicles.push({
                                agentid: agentid,
                                vehiclenumber: vehiclenumber,
                                value: value,
                                timestamp: timestamp
                            });
                        }
                    }
                }
            });
        });

        me.alarmData = newAlarmData;

        // Обновляем счётчики в левом store
        var leftStore = me.leftStore;
        leftStore.each(function (record) {
            var alarmName = record.get('alarmName');
            var count = newAlarmData[alarmName] ? newAlarmData[alarmName].count : 0;
            record.set('count', count);
        });
        leftStore.commitChanges();

        // Если выбран какой-то тип неполадки, обновляем правую панель
        if (me.selectedAlarm) {
            me.updateRightPanel(me.selectedAlarm);
        }
    },

    /**
     * Обновление правой панели (список ТС) для выбранной неполадки.
     * @param {String} alarmName - полное имя датчика (например, "EXT ТС в движении")
     */
    updateRightPanel: function (alarmName) {
        var me = this;
        var rightStore = me.rightStore;

        rightStore.removeAll();

        if (me.alarmData && me.alarmData[alarmName]) {
            var vehicles = me.alarmData[alarmName].vehicles || [];
            rightStore.loadData(vehicles);
        }

        // Обновляем заголовок правой панели (можно отобразить название неполадки)
        var mainPanel = me.getMainPanel();
        if (mainPanel) {
            var displayName = (alarmName === 'EXT ТС в движении') ? 'ТС в движении' : 'Низкий уровень топлива';
            mainPanel.setTitle('Список ТС: ' + displayName);
        }
    },

    /**
     * Вспомогательный метод для получения правой панели (map_frame) через navTab.
     * Предполагается, что navTab.map_frame хранит ссылку на mainPanel.
     */
    getMainPanel: function () {
        var me = this;
        // Ищем вкладку в skeleton.navigation, которая является нашим navTab.
        if (!me.navTab) {
            var items = skeleton.navigation.items;
            for (var i = 0; i < items.length; i++) {
                if (items[i].title === 'Мониторинг неполадок') {
                    me.navTab = items[i];
                    break;
                }
            }
        }
        return me.navTab ? me.navTab.map_frame : null;
    },

    /**
     * Очистка ресурсов (таймер) – может быть вызвано системой при выгрузке расширения.
     */
    destroy: function () {
        var me = this;
        if (me.refreshTask) {
            clearInterval(me.refreshTask);
            me.refreshTask = null;
        }
        me.callParent();
    }
});