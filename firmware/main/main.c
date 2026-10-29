// ESP32 Wake-on-LAN bridge: MQTT "wake" message -> magic packet on the LAN.
#include <string.h>
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "lwip/sockets.h"
#include "mqtt_client.h"
#include "nvs_flash.h"
#include "secrets.h"

#define TOPIC_CMD    "wol/desktop"         // publish "wake" here
#define TOPIC_STATUS "wol/desktop/status"  // retained "online"/"offline" (LWT)

static const char *TAG = "wol";
static esp_mqtt_client_handle_t mqtt;

static void send_magic_packet(void)
{
    const uint8_t mac[6] = PC_MAC;
    uint8_t packet[6 + 16 * 6];
    memset(packet, 0xFF, 6);
    for (int i = 1; i <= 16; i++) {
        memcpy(&packet[i * 6], mac, 6);
    }

    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock < 0) {
        ESP_LOGE(TAG, "socket() failed: errno %d", errno);
        return;
    }
    int yes = 1;
    setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &yes, sizeof(yes));
    struct sockaddr_in dest = {
        .sin_family = AF_INET,
        .sin_port = htons(9),
        .sin_addr.s_addr = htonl(INADDR_BROADCAST),
    };
    // UDP is fire-and-forget; send a few times in case one gets dropped
    for (int i = 0; i < 3; i++) {
        if (sendto(sock, packet, sizeof(packet), 0, (struct sockaddr *)&dest, sizeof(dest)) < 0) {
            ESP_LOGE(TAG, "sendto() failed: errno %d", errno);
        }
    }
    close(sock);
    ESP_LOGI(TAG, "Magic packet sent");
}

static void on_mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = data;
    switch ((esp_mqtt_event_id_t)id) {
    case MQTT_EVENT_CONNECTED:
        ESP_LOGI(TAG, "MQTT connected");
        esp_mqtt_client_subscribe(mqtt, TOPIC_CMD, 1);
        esp_mqtt_client_publish(mqtt, TOPIC_STATUS, "online", 0, 1, 1);
        break;
    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "MQTT disconnected");
        break;
    case MQTT_EVENT_DATA:
        // Ignore retained messages so a stale "wake" doesn't fire on every reconnect
        if (event->retain) {
            ESP_LOGW(TAG, "Ignoring retained message");
            break;
        }
        if (event->data_len == 4 && strncmp(event->data, "wake", 4) == 0) {
            send_magic_packet();
        } else {
            ESP_LOGW(TAG, "Unknown command: %.*s", event->data_len, event->data);
        }
        break;
    default:
        break;
    }
}

static void start_mqtt(void)
{
    esp_mqtt_client_config_t cfg = {
        .broker.address.uri = MQTT_URI,
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach,
        .credentials.username = MQTT_USER,
        .credentials.authentication.password = MQTT_PASS,
        .credentials.client_id = "esp32-wol",
        .session.keepalive = 30,
        .session.last_will = {
            .topic = TOPIC_STATUS,
            .msg = "offline",
            .qos = 1,
            .retain = 1,
        },
    };
    mqtt = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(mqtt, ESP_EVENT_ANY_ID, on_mqtt_event, NULL);
    esp_mqtt_client_start(mqtt);
}

static void on_wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "Wi-Fi disconnected, retrying");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = data;
        ESP_LOGI(TAG, "Got IP " IPSTR, IP2STR(&event->ip_info.ip));
        // esp-mqtt reconnects on its own after this, so start it only once
        if (mqtt == NULL) {
            start_mqtt();
        }
    }
}

static void start_wifi(void)
{
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi_event, NULL));

    wifi_config_t cfg = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    start_wifi();
}
