using Microsoft.EntityFrameworkCore;
using lab_guardian_gateway.Models;

namespace lab_guardian_gateway.Data;

public class LabDbContext : DbContext
{
    public DbSet<EventLog> EventLogs => Set<EventLog>();
    public DbSet<Robot> Robots => Set<Robot>();

    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        // 💡 [핵심 수정] 상대 경로(../) 대신 바탕화면 프로젝트 폴더의 절대 경로를 사용합니다.
        // 이렇게 하면 bin 폴더나 상위 폴더가 아닌, 사용자님이 보고 계신 그 폴더에 파일이 생깁니다.
        string dbPath = @"C:\Users\kisoo\Desktop\lab-guardian\lab-guardian-gateway\LogDatabase.db";
        options.UseSqlite($"Data Source={dbPath}");
    }
}