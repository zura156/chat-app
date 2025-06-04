import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatboxSettingsComponent } from './chatbox-settings.component';

describe('ChatboxSettingsComponent', () => {
  let component: ChatboxSettingsComponent;
  let fixture: ComponentFixture<ChatboxSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatboxSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChatboxSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
