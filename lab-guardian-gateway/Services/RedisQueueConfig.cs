namespace lab_guardian_gateway.Services;

public static class RedisQueueConfig {
    public const string EventQueue = "event_queue";
    public const string DangerQueue = "danger_queue";
    public const string DlqQueue = "dlq_queue";
    public const int BacklogThreshold = 50000;
    public const int DangerBurstLimit = 5;
    public const int BatchSize = 50;
}
